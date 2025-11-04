// apps/server/src/services/audit.ts
import { prisma } from '../lib/prisma.js';

/** Extract admin id, IP and UA consistently */
export function adminIdFromReq(req: any): string | null {
  return (req && req.admin && req.admin.sub) ? String(req.admin.sub) : null;
}
export function ipFromReq(req: any): string | null {
  const xf = (req?.headers?.['x-forwarded-for'] as string) || '';
  if (xf) return xf.split(',')[0].trim();
  return (req?.socket?.remoteAddress as string) || null;
}
export function uaFromReq(req: any): string | null {
  return (req?.headers?.['user-agent'] as string) || null;
}

/**
 * Write a row in AdminAuditLog. Fire-and-forget (never throws).
 * action:        short action key, e.g. "admin.create", "merchant.update", "payment.status.change"
 * targetType/id: optional pointer to affected entity
 * meta:          optional JSON with extra details
 */
export async function auditAdmin(
  req: any,
  action: string,
  targetType?: string | null,
  targetId?: string | null,
  meta?: any
) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId: adminIdFromReq(req),
        action,
        targetType: targetType || null,
        targetId: targetId || null,
        ip: ipFromReq(req),
        meta: meta ?? null,
      },
    });
  } catch {
    // swallow on purpose: observability must not block the action
  }
}


// Add to apps/server/src/services/audit.ts
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";

function scrubBody(body: any) {
  if (!body || typeof body !== "object") return body ?? null;
  const clone: any = Array.isArray(body) ? body.slice(0, 50) : { ...body };
  // Redact obvious secrets
  ["password", "confirm", "code", "token", "totp", "secret", "secretBase32"].forEach((k) => {
    if (k in clone) clone[k] = "[redacted]";
  });
  return clone;
}

/**
 * Generic write-audit net for /admin routes:
 * logs POST/PUT/PATCH/DELETE with path, IP, UA and scrubbed body.
 * Mount it only after requireAdmin so req.admin is present.
 */
export function auditHttpWrites() {
  return function (req: any, res: Response, next: NextFunction) {
    const methods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
    if (!methods.has(req.method)) return next();

    const started = Date.now();
    const done = async () => {
      res.removeListener("finish", done);
      res.removeListener("close", done);
      try {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          await prisma.adminAuditLog.create({
            data: {
              adminId: req.admin?.sub || null,
              action: `http.${req.method.toLowerCase()}`,
              targetType: "ROUTE",
              targetId: (req.route && req.route.path) || req.originalUrl || req.url,
              ip: req.ip,
              meta: {
                url: req.originalUrl || req.url,
                method: req.method,
                status: res.statusCode,
                durationMs: Date.now() - started,
                body: scrubBody(req.body),
                query: req.query || null,
                ua: req.headers["user-agent"] || null,
              },
            },
          });
        }
      } catch {
        /* swallow on purpose */
      }
    };

    res.on("finish", done);
    res.on("close", done);
    next();
  };
}