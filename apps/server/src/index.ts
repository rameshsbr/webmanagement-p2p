// apps/server/src/index.ts
import "dotenv/config";
import "./lib/augmentExpress.js";

import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejsMate from "ejs-mate";
import jwt from "jsonwebtoken";
import cors from "cors";
import { checkoutPublicRouter } from "./routes/checkoutPublic.js";
import { diditWebhookRouter } from "./routes/webhooks.js";

import { prisma } from "./lib/prisma.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { responseHelpers } from "./middleware/responseHelpers.js";
import { captureRawBody } from "./middleware/rawBody.js";

import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { adminSecurityRouter } from "./routes/adminSecurity.js";
import { merchantApiRouter } from "./routes/merchantApi.js";
import { publicRouter } from "./routes/public.js";
import { webhookRouter } from "./routes/webhooks.js";
import { sdkRouter } from "./routes/sdk.js";
import { requireAdmin } from "./middleware/auth.js";
import { merchantPortalRouter } from "./routes/merchantPortal.js";

// import { requireMerchantSession } from "./middleware/auth.js"; // no longer used
import { superAdminRouter } from './routes/superAdmin.js';
import { auditHttpWrites } from "./services/audit.js";
import { backfillShortIdentifiers } from "./services/backfillShortIds.js";


const app = express();

backfillShortIdentifiers().catch((err) => {
  console.warn("[BOOT] short-id backfill skipped", err?.message || err);
});

// Security & logging
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'", "https://challenges.cloudflare.com"],
        "frame-src": ["'self'", "https://challenges.cloudflare.com"],
        "connect-src": ["'self'", "https://challenges.cloudflare.com"],
        "img-src": ["'self'", "data:"],
        "style-src": ["'self'", "'unsafe-inline'"],
      },
    },
  })
);
app.use(morgan("dev"));

app.use(express.json({ limit: "2mb", verify: captureRawBody }));
app.use(express.urlencoded({ extended: true, verify: captureRawBody }));
app.use(cookieParser());
app.use(responseHelpers);

// Views & static
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.locals.basedir = path.join(__dirname, "views");

// NEW: serve /public static assets (checkout-widget.js, merchant.js, etc.)
app.use("/public", express.static(path.join(__dirname, "public")));

app.use("/static", express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Boot logs
const IS_LOCAL = !process.env.NODE_ENV || process.env.NODE_ENV === "development";
console.log("[BOOT] NODE_ENV=", process.env.NODE_ENV);
console.log("[BOOT] IS_LOCAL =", IS_LOCAL);
console.log("[BOOT] ADMIN_DEBUG =", process.env.ADMIN_DEBUG);
console.log("[BOOT] JWT_SECRET set? ->", Boolean(process.env.JWT_SECRET));

// Helpers
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

function hasValidAdminJWT(req: any): boolean {
  const tok =
    req.cookies?.admin_jwt ||
    req.cookies?.admin ||
    req.cookies?.session ||
    req.cookies?.token ||
    null;
  if (!tok) return false;
  try {
    jwt.verify(tok, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

// THEME for SSR
app.use((req: any, res: any, next: any) => {
  const t = req.cookies?.merchant_theme === "dark" ? "dark" : "light";
  res.locals.theme = t;
  next();
});

// safe locals for all views
app.use((req: any, res: any, next: any) => {
  if (typeof res.locals.admin === "undefined") res.locals.admin = null;
  if (typeof res.locals.title === "undefined") res.locals.title = "Admin";
  if (typeof res.locals.isAuthView === "undefined") res.locals.isAuthView = false;
  if (typeof res.locals.formatDateTime === "undefined") {
    const dtFormatter = new Intl.DateTimeFormat("en-AU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
    const dateFormatter = new Intl.DateTimeFormat("en-AU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const timeFormatter = new Intl.DateTimeFormat("en-AU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
    const ensureDate = (value: Date | string | null | undefined) => {
      if (!value) return null;
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      return date;
    };
    res.locals.formatDateTime = (value: Date | string | null | undefined) => {
      const date = ensureDate(value);
      if (!date) return "-";
      return dtFormatter.format(date);
    };
    res.locals.formatDateParts = (value: Date | string | null | undefined) => {
      const date = ensureDate(value);
      if (!date) return null;
      return { date: dateFormatter.format(date), time: timeFormatter.format(date) };
    };
    res.locals.renderDateTime = (value: Date | string | null | undefined) => {
      const parts = res.locals.formatDateParts(value);
      if (!parts) return "-";
      return `<span class="date-stack"><span>${parts.date}</span><span>${parts.time}</span></span>`;
    };
  }
  if (typeof res.locals.formatAmount === "undefined") {
    res.locals.formatAmount = (cents: number, currency?: string | null) => {
      if (typeof cents !== "number" || !Number.isFinite(cents)) return "-";
      const abs = Math.abs(cents);
      const hasFraction = abs % 100 !== 0;
      const value = (cents / 100).toLocaleString("en-AU", {
        minimumFractionDigits: hasFraction ? 2 : 0,
        maximumFractionDigits: hasFraction ? 2 : 0,
      });
      return currency ? `${value} ${currency}` : value;
    };
  }
  if (typeof res.locals.formatDuration === "undefined") {
    res.locals.formatDuration = (start?: Date | string | null, end?: Date | string | null) => {
      if (!start || !end) return "-";
      const s = start instanceof Date ? start : new Date(start);
      const e = end instanceof Date ? end : new Date(end);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "-";
      const diff = Math.max(0, e.getTime() - s.getTime());
      const totalSeconds = Math.floor(diff / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      const parts = [] as string[];
      if (hours) parts.push(`${hours}h`);
      if (minutes) parts.push(`${minutes}m`);
      if (!parts.length || seconds) parts.push(`${seconds}s`);
      return parts.join(" ") || "0s";
    };
  }
  next();
});

// mark /auth pages
app.use("/auth", (req: any, res: any, next: any) => {
  res.locals.isAuthView = true;
  res.locals.siteKey = process.env.TURNSTILE_SITE_KEY || "";
  next();
});

// when inside /admin, attach admin locals
const withAdminLocals = (req: any, res: any, next: any) => {
  res.locals.admin = req.admin || null;
  res.locals.isAuthView = false;
  next();
};

// Routes

app.use(diditWebhookRouter);

// root: if admin cookie present → /admin, else admin login
app.get("/", (req, res) => {
  if (hasValidAdminJWT(req)) return res.redirect("/admin");
  return res.redirect("/auth/admin/login");
});

// auth router first
app.use("/auth", authRouter);

// SUPER ADMIN — DO NOT wrap in requireAdmin (router has its own SUPER guard)
app.use('/superadmin', superAdminRouter);
app.get('/super', (_req, res) => res.redirect('/auth/super/login'));
app.get('/superadmin/login', (_req, res) => res.redirect('/auth/super/login'));

// admin area (behind admin guard)
app.use("/admin", requireAdmin, withAdminLocals, auditHttpWrites(), adminSecurityRouter);
app.use("/admin", requireAdmin, withAdminLocals, auditHttpWrites(), adminRouter);

// other routers
app.use("/webhooks", webhookRouter);
app.use("/sdk", sdkRouter);
app.use("/api/v1", merchantApiRouter);

// Allowlisted origins for embedded modal (comma-separated list in env)
const allowList = (process.env.CHECKOUT_ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

app.use(
  ["/public", "/merchant/checkout/session"],
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // allow same-origin / server-side
      if (allowList.includes(origin)) return cb(null, true);
      return cb(new Error("CORS: origin not allowed"));
    },
    credentials: true,
  })
);

// Public checkout endpoints (must be before generic /public and /merchant)
app.use(checkoutPublicRouter);

// Other public pages
app.use("/public", publicRouter);

// Merchant portal — use its internal tolerant guard (no requireMerchantSession here)
app.use("/merchant", merchantPortalRouter);

// debug: admin token payload
app.get("/auth/whoami", (req, res) => {
  const names = Object.keys((req as any).cookies || {});
  const token = (req as any).cookies?.admin_jwt || (req as any).cookies?.admin;
  let decoded: any = null;
  let error: any = null;
  if (token) {
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e: any) {
      error = { name: e?.name, message: e?.message };
    }
  }
  res.json({
    cookies: names,
    hasAdminCookie: Boolean(token),
    adminCookieName: token
      ? (req as any).cookies.admin_jwt
        ? "admin_jwt"
        : "admin"
      : null,
    decoded,
    error,
  });
});

// errors last
app.use(errorHandler);

// Start
const PORT = Number(process.env.PORT ?? 4000);
const server = app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

process.on("SIGINT", async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});