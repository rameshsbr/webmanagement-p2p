import type { Request, Response, NextFunction } from 'express';
export function responseHelpers(_req: Request, res: Response, next: NextFunction) {
  res.ok = (data?: unknown) => res.status(200).json({ ok: true, data });
  res.badRequest = (msg: string) => res.status(400).json({ ok: false, error: msg });
  res.unauthorized = (msg = 'Unauthorized') => res.status(401).json({ ok: false, error: msg });
  res.forbidden = (msg = 'Forbidden') => res.status(403).json({ ok: false, error: msg });
  res.notFound = (msg = 'Not Found') => res.status(404).json({ ok: false, error: msg });
  next();
}