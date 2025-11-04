// apps/server/src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

function pick<T>(v: T | undefined | null): T | null {
  return (v === undefined || v === null) ? null : v;
}

/** Admin guard (unchanged behavior) */
export function requireAdmin(req: any, res: Response, next: NextFunction) {
  const tok =
    req.cookies?.admin_jwt ||
    req.cookies?.admin ||
    req.cookies?.session ||
    req.cookies?.token ||
    null;

  if (!tok) return res.redirect("/auth/admin/login");

  try {
    const p: any = jwt.verify(tok, JWT_SECRET);
    req.admin = p; // expose entire payload; downstream uses req.admin?.sub / role
    return next();
  } catch {
    // clear known admin cookies
    try {
      res.clearCookie("admin_jwt", { path: "/" });
      res.clearCookie("admin",     { path: "/" });
      res.clearCookie("session",   { path: "/" });
      res.clearCookie("token",     { path: "/" });
    } catch {}
    return res.redirect("/auth/admin/login");
  }
}

/**
 * Merchant session guard.
 * Accepts both old and new token shapes:
 *  - old:   { sub: <merchantId> }
 *  - new:   { sub: <merchantUserId>, merchantId: <merchantId> }
 * Exposes req.merchant.sub = <merchantId> for compatibility.
 */
export function requireMerchantSession(req: any, res: Response, next: NextFunction) {
  const tok =
    req.cookies?.merchant_jwt ||
    req.cookies?.merchant ||
    null;

  if (!tok) return res.redirect("/auth/merchant/login");

  try {
    const p: any = jwt.verify(tok, JWT_SECRET);

    // Prefer explicit merchantId (new tokens), fall back to sub (old tokens)
    const merchantId =
      pick<string>(p.merchantId) ||
      pick<string>(p.mid) ||
      pick<string>(p.merchant) ||
      pick<string>(p.sub); // old tokens had sub = merchantId

    if (!merchantId) {
      try {
        res.clearCookie("merchant_jwt", { path: "/" });
        res.clearCookie("merchant",     { path: "/" });
      } catch {}
      return res.redirect("/auth/merchant/login");
    }

    // What the portal code expects:
    req.merchant = { sub: merchantId };
    // Also keep the full decoded token around if needed
    req.merchantAuth = p;

    return next();
  } catch {
    try {
      res.clearCookie("merchant_jwt", { path: "/" });
      res.clearCookie("merchant",     { path: "/" });
    } catch {}
    return res.redirect("/auth/merchant/login");
  }
}