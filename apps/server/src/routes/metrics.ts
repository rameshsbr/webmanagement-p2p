import { Router } from "express";
import jwt from "jsonwebtoken";
import { resolveTimezone } from "../lib/timezone.js";
import { getMetricsOverview, getMetricsTimeseries } from "../services/metrics/metrics-v1.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

function parseMerchantIds(input: any): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.flatMap((v) => String(v || "").split(",")).map((v) => v.trim()).filter(Boolean);
  }
  return String(input || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseMethods(input: any): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .flatMap((v) => String(v || "").split(","))
      .map((v) => v.trim().toUpperCase())
      .filter(Boolean);
  }
  return String(input || "")
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
}

function resolveAuth(req: any) {
  const adminToken =
    req.cookies?.admin_jwt ||
    req.cookies?.admin ||
    req.cookies?.session ||
    req.cookies?.token ||
    null;
  if (adminToken) {
    try {
      const payload: any = jwt.verify(adminToken, JWT_SECRET);
      return { role: "admin" as const, adminId: payload?.sub || null };
    } catch {}
  }

  const merchantToken = req.cookies?.merchant_jwt || req.cookies?.merchant || null;
  if (merchantToken) {
    try {
      const payload: any = jwt.verify(merchantToken, JWT_SECRET);
      const merchantId = payload?.merchantId || payload?.mid || payload?.merchant || payload?.sub || null;
      if (merchantId) return { role: "merchant" as const, merchantId };
    } catch {}
  }
  return null;
}

router.get("/v1/overview", async (req: any, res) => {
  const auth = resolveAuth(req);
  if (!auth) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const tz = resolveTimezone(req.query?.tz || req.query?.timezone || "");
  const methods = parseMethods(req.query?.method || req.query?.methods);
  let merchantIds = parseMerchantIds(req.query?.merchantId || req.query?.merchantIds);

  if (auth.role === "merchant") {
    merchantIds = auth.merchantId ? [auth.merchantId] : [];
  }

  const data = await getMetricsOverview({
    from: req.query?.from,
    to: req.query?.to,
    tz,
    methods,
    merchantIds,
  });

  return res.json({ ok: true, ...data });
});

router.get("/v1/timeseries", async (req: any, res) => {
  const auth = resolveAuth(req);
  if (!auth) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const tz = resolveTimezone(req.query?.tz || req.query?.timezone || "");
  const methods = parseMethods(req.query?.method || req.query?.methods);
  let merchantIds = parseMerchantIds(req.query?.merchantId || req.query?.merchantIds);

  if (auth.role === "merchant") {
    merchantIds = auth.merchantId ? [auth.merchantId] : [];
  }

  const data = await getMetricsTimeseries({
    from: req.query?.from,
    to: req.query?.to,
    tz,
    methods,
    merchantIds,
  });

  return res.json({ ok: true, ...data });
});

export default router;