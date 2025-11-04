// apps/server/src/middleware/merchantLimits.ts
import { prisma } from "../lib/prisma.js";

/**
 * Extract best-effort client IP.
 */
function clientIp(req: any): string {
  const xf = String(req.get?.("x-forwarded-for") || "").split(",")[0]?.trim();
  const ip = xf || req.ip || req.connection?.remoteAddress || "";
  return ip.replace(/^::ffff:/, "");
}

/**
 * Match exact IP or simple prefix rule with trailing '*'
 *   e.g. "203.0.113.*"
 */
function ipMatches(rule: string, ip: string): boolean {
  const r = rule.trim();
  if (!r) return false;
  if (r === ip) return true;
  if (r.endsWith("*")) {
    const prefix = r.slice(0, -1);
    return ip.startsWith(prefix);
  }
  return false;
}

// very simple in-memory fixed-window counters (swap for Redis in prod)
const rateBuckets = new Map<string, { window: number; count: number }>();

/**
 * Enforce MerchantLimits:
 *  - ipAllowList (exact or prefix*)
 *  - maxReqPerMin (fixed window)
 * Works for both API-key and HMAC flows as long as req.merchantId is set.
 */
export async function applyMerchantLimits(req: any, res: any, next: any) {
  const merchantId: string | undefined = req.merchantId;
  if (!merchantId) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const limits = await prisma.merchantLimits.findUnique({ where: { merchantId } });

  // IP allow-list
  if (limits && Array.isArray(limits.ipAllowList) && limits.ipAllowList.length > 0) {
    const ip = clientIp(req);
    const allowed = limits.ipAllowList.some((rule) => ipMatches(rule, ip));
    if (!allowed) {
      return res.forbidden ? res.forbidden("IP not allowed") : res.status(403).json({ ok: false, error: "IP not allowed" });
    }
  }

  // Rate limit
  const max = limits?.maxReqPerMin ?? null;
  if (max && Number.isFinite(max) && max > 0) {
    const now = Date.now();
    const win = Math.floor(now / 60000); // per-minute window
    const key = `${merchantId}:${win}`;
    const rec = rateBuckets.get(key) || { window: win, count: 0 };
    rec.count += 1;
    rateBuckets.set(key, rec);

    const remaining = Math.max(0, (max as number) - rec.count);
    const resetMs = (win + 1) * 60000 - now;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil((now + resetMs) / 1000)));

    if (rec.count > (max as number)) {
      return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
    }

    // opportunistic GC of previous window
    const prevKey = `${merchantId}:${win - 1}`;
    if (rateBuckets.has(prevKey)) rateBuckets.delete(prevKey);
  }

  next();
}