// apps/server/src/routes/public.ts
import { Router } from "express";
import jwt from "jsonwebtoken";
import { requireMerchantSession } from "../middleware/auth.js";
import { enforceTurnstile } from "../middleware/turnstile.js";
import { prisma } from "../lib/prisma.js";

export const publicRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// Login form (render)
publicRouter.get("/merchant/login", (_req, res) => {
  res.render("merchant-login", {
    title: "Merchant Login",
    error: null,
    siteKey: res.locals.siteKey,
  });
});

// Login submit (env-based demo credentials)
publicRouter.post("/merchant/login", enforceTurnstile, (req, res) => {
  const { email, password } = req.body || {};
  const ok =
    email === process.env.MERCHANT_DEMO_EMAIL &&
    password === process.env.MERCHANT_DEMO_PASSWORD &&
    process.env.MERCHANT_DEMO_ID;

  if (!ok) {
    return res.status(401).render("merchant-login", {
      title: "Merchant Login",
      error: "Invalid credentials",
      siteKey: res.locals.siteKey,
    });
  }

  const token = jwt.sign(
    { sub: process.env.MERCHANT_DEMO_ID as string, role: "merchant" },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.cookie("merchant_jwt", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });

  return res.redirect("/merchant");
});

// Logout
publicRouter.get("/merchant/logout", (_req, res) => {
  try {
    res.clearCookie("merchant_jwt", { path: "/" });
  } catch {}
  res.redirect("/public/merchant/login");
});

// Legacy dashboard route → keep but redirect to new portal root
publicRouter.get("/merchant/dashboard", requireMerchantSession, async (_req: any, res) => {
  return res.redirect("/merchant");
});

// (Optional) If you still want to render legacy template directly, uncomment:
/*
publicRouter.get("/merchant/dashboard-legacy", requireMerchantSession, async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  const m = await prisma.merchant.findUnique({
    where: { id: merchantId },
    include: {
      paymentReqs: { orderBy: { createdAt: "desc" }, take: 20 },
      ledger: true,
    },
  });
  res.render("merchant-dashboard", { merchant: m });
});
*/

// Demo page simulating Didit UI (kept as-is)
publicRouter.get("/fake-didit", (req, res) => {
  const { session, subj } = req.query as any;
  res.render("fake-didit", { session, subj });
});