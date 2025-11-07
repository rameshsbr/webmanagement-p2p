import type { Request, Response, NextFunction } from 'express';
export function captureRawBody(req: Request, _res: Response, buf: Buffer, encoding: BufferEncoding) {
  if (buf && buf.length) {
    const raw = buf.toString(encoding || 'utf8');
    (req as any)._rawBody = raw;
    req.rawBody = raw;
  }
}
export function rawBodyMiddleware(req: Request, res: Response, next: NextFunction) {
  next();
}