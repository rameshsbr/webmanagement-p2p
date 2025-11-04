// apps/server/src/middleware/roles.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

type Role = 'SUPER' | 'ADMIN' | 'SUPPORT';
type AllowedParam = Role | 'SUPERADMIN' | Array<Role | 'SUPERADMIN'>;

function normalizeRole(r?: string): Role {
  const s = String(r || 'ADMIN').toUpperCase();
  if (s === 'SUPERADMIN') return 'SUPER';  // treat SUPERADMIN as SUPER
  if (s === 'OWNER') return 'SUPER';       // safety alias if it ever appears
  if (s === 'SUPPORT') return 'SUPPORT';
  // default to ADMIN / SUPER as provided
  return s as Role;
}

function pickToken(req: any): string | null {
  return (
    req.cookies?.admin_jwt ||
    req.cookies?.admin ||
    req.cookies?.session ||
    req.cookies?.token ||
    null
  );
}

function clearAuthCookies(res: Response) {
  try {
    res.clearCookie('admin_jwt', { path: '/' });
    res.clearCookie('admin',     { path: '/' });
    res.clearCookie('session',   { path: '/' });
    res.clearCookie('token',     { path: '/' });
  } catch {}
}

/**
 * Require one of the allowed roles.
 * Usage:
 *   requireRole('ADMIN')
 *   requireRole('SUPER')
 *   requireRole(['SUPER'])
 *   requireRole(['ADMIN','SUPER'])
 */
export function requireRole(allowed: AllowedParam) {
  const allowSet = new Set(
    (Array.isArray(allowed) ? allowed : [allowed]).map((r) => normalizeRole(r))
  );

  // If the route is SUPER-only, send users to the super login page when unauth'd
  const wantsSuperOnly = allowSet.size === 1 && allowSet.has('SUPER');
  const loginPath = wantsSuperOnly ? '/auth/super/login' : '/auth/admin/login';

  return (req: any, res: Response, next: NextFunction) => {
    const tok = pickToken(req);

    // No token → send to the right login for this area
    if (!tok) {
      return res.redirect(loginPath);
    }

    try {
      const payload: any = jwt.verify(tok, JWT_SECRET);
      const have = normalizeRole(payload.role);

      // Wrong role → steer to the appropriate login instead of 403
      if (!allowSet.has(have)) {
        clearAuthCookies(res);
        return res.redirect(loginPath);
      }

      // Expose auth payload downstream if needed
      req.admin = payload;
      return next();
    } catch {
      // Expired / invalid token → clear cookies and send to the right login
      clearAuthCookies(res);
      return res.redirect(loginPath);
    }
  };
}