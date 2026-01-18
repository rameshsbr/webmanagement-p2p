// apps/server/src/index.ts
import "dotenv/config";
import express from "express";
import { augmentExpress } from "./lib/augmentExpress.js";
import { fazzWebhookRouter } from "./routes/webhooks-fazz.js";
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
import { monoovaWebhookRouter } from "./routes/webhooks-monoova.js";

import { prisma } from "./lib/prisma.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { responseHelpers } from "./middleware/responseHelpers.js";
import { captureRawBody } from "./middleware/rawBody.js";

import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { adminSecurityRouter } from "./routes/adminSecurity.js";
import { merchantApiRouter } from "./routes/merchantApi.js";
import metricsRouter from "./routes/metrics.js";
import { publicRouter } from "./routes/public.js";
import { webhookRouter } from "./routes/webhooks.js";
import { sdkRouter } from "./routes/sdk.js";
import { requireAdmin } from "./middleware/auth.js";
import { merchantPortalRouter } from "./routes/merchantPortal.js";

// import { requireMerchantSession } from "./middleware/auth.js"; // no longer used
import { superAdminRouter } from "./routes/superAdmin.js";
import { auditHttpWrites } from "./services/audit.js";
import { backfillShortIdentifiers } from "./services/backfillShortIds.js";
import { defaultTimezone, resolveTimezone } from "./lib/timezone.js";
import { formatJakartaDDMMYYYY_12h } from "./utils/datetime.js";
import { startFazzSweep } from "./services/providers/fazz-poller.js";

const app = express();
augmentExpress(app);

app.use((_, res, next) => {
  if (typeof res.locals.siteKey === "undefined") {
    res.locals.siteKey = process.env.TURNSTILE_SITE_KEY || "";
  }
  next();
});

backfillShortIdentifiers().catch((err) => {
  console.warn("[BOOT] short-id backfill skipped", err?.message || err);
});
startFazzSweep();

app.use(
  "/webhooks/fazz",
  // accept all JSON-ish content types (Fazz uses application/vnd.api+json)
  express.raw({ type: ["application/json", "application/*+json", "application/vnd.api+json"] }),
  (req: any, _res, next) => {
    if (!req.rawBody && Buffer.isBuffer(req.body)) req.rawBody = req.body; // make raw available to router
    next();
  },
  fazzWebhookRouter
);

app.use("/webhooks/monoova", monoovaWebhookRouter);

app.use(express.json({ limit: "2mb", verify: captureRawBody }));
app.use(express.urlencoded({ extended: true, verify: captureRawBody }));

// ✅ MUST come before any router that relies on cookies (metrics uses JWT cookies)
app.use(cookieParser());
app.use(responseHelpers);

// Mount early routers that do not require CSP/morgan to run first.
app.use("/api/merchant", merchantApiRouter);
app.use("/metrics", metricsRouter);

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

// Views & static
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.locals.basedir = path.join(__dirname, "views");
app.locals.formatJakartaDDMMYYYY_12h = formatJakartaDDMMYYYY_12h;
app.locals.buildId = process.env.BUILD_ID || Date.now().toString();

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
if (IS_LOCAL) {
  console.log("[SECURITY] TURNSTILE_SITE_KEY set?", Boolean(process.env.TURNSTILE_SITE_KEY));
  console.log("[SECURITY] TURNSTILE_SECRET_KEY set?", Boolean(process.env.TURNSTILE_SECRET_KEY));
  if (!process.env.TURNSTILE_SITE_KEY) {
    console.warn("[SECURITY] Cloudflare Turnstile disabled in dev (missing site key)");
  }
}

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
  if (typeof res.locals.timezone === "undefined") res.locals.timezone = "";
  if (typeof res.locals.getTimezone !== "function") {
    res.locals.getTimezone = () => {
      const tz = typeof res.locals.timezone === "string" && res.locals.timezone ? res.locals.timezone : defaultTimezone();
      return tz;
    };
  }
  if (typeof res.locals.formatDateTime === "undefined") {
    type FormatterSet = {
      dateTime: Intl.DateTimeFormat;
      date: Intl.DateTimeFormat;
      time: Intl.DateTimeFormat;
    };
    const cache = new Map<string, FormatterSet>();
    const ensureDate = (value: Date | string | null | undefined) => {
      if (!value) return null;
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      return date;
    };
    const getFormatters = (tzRaw?: string): FormatterSet => {
      const tz = resolveTimezone(tzRaw);
      const existing = cache.get(tz);
      if (existing) return existing;
      const formatter: FormatterSet = {
        dateTime: new Intl.DateTimeFormat("en-AU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
          timeZone: tz,
        }),
        date: new Intl.DateTimeFormat("en-AU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          timeZone: tz,
        }),
        time: new Intl.DateTimeFormat("en-AU", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
          timeZone: tz,
        }),
      };
      cache.set(tz, formatter);
      return formatter;
    };
    const escapeAttr = (value: string) => value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    res.locals.formatDateTime = (value: Date | string | null | undefined, tzOverride?: string) => {
      const target = ensureDate(value);
      if (!target) return "-";
      const tz = tzOverride || res.locals.getTimezone();
      const { dateTime } = getFormatters(tz);
      return dateTime.format(target);
    };
    res.locals.formatDateParts = (value: Date | string | null | undefined, tzOverride?: string) => {
      const target = ensureDate(value);
      if (!target) return null;
      const tz = tzOverride || res.locals.getTimezone();
      const formatterSet = getFormatters(tz);
      return {
        date: formatterSet.date.format(target),
        time: formatterSet.time.format(target),
      };
    };
    res.locals.renderDateTime = (value: Date | string | null | undefined, tzOverride?: string) => {
      const target = ensureDate(value);
      if (!target) return "-";
      const tz = tzOverride || res.locals.getTimezone();
      const formatters = getFormatters(tz);
      const iso = escapeAttr(target.toISOString());
      const dateText = escapeAttr(formatters.date.format(target));
      const timeText = escapeAttr(formatters.time.format(target));
      return `<span class="date-stack" data-dt="${iso}" data-tz="${escapeAttr(tz)}"><span>${dateText}</span><span>${timeText}</span></span>`;
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
const withAdminLocals = async (req: any, res: any, next: any) => {
  res.locals.isAuthView = false;

  const session = req.admin || null;
  res.locals.admin = session || null;

  const adminId = session?.sub ? String(session.sub) : null;
  if (!adminId) {
    const fallbackTz = session?.timezone ? resolveTimezone(session.timezone) : defaultTimezone();
    res.locals.timezone = fallbackTz;
    (req as any).activeTimezone = fallbackTz;
    return next();
  }

  try {
    const admin = await prisma.adminUser.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        canViewUserDirectory: true,
        timezone: true,
      },
    });

    if (admin) {
      const canViewUsers = admin.canViewUserDirectory !== false;
      req.adminDetails = admin;
      req.adminCanViewUsers = canViewUsers;
      const timezone = resolveTimezone(admin.timezone);
      res.locals.timezone = timezone;
      (req as any).activeTimezone = timezone;
      if (session) {
        session.canViewUsers = canViewUsers;
        session.timezone = timezone;
      }
      res.locals.admin = {
        ...session,
        ...admin,
        canViewUsers,
      };
    }
  } catch {
    // ignore lookup errors, fall back to session payload
  }

  if (!res.locals.timezone) {
    const fallbackTz = session?.timezone ? resolveTimezone(session.timezone) : defaultTimezone();
    res.locals.timezone = fallbackTz;
    (req as any).activeTimezone = fallbackTz;
  }
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
app.use("/superadmin", superAdminRouter);
app.get("/super", (_req, res) => res.redirect("/auth/super/login"));
app.get("/superadmin/login", (_req, res) => res.redirect("/auth/super/login"));

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
