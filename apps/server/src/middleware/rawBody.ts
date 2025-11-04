import type { Request, Response, NextFunction } from 'express';
export function captureRawBody(req: Request, _res: Response, buf: Buffer, encoding: BufferEncoding) {
  if (buf && buf.length) {
    (req as any)._rawBody = buf.toString(encoding || 'utf8');
  }
}
export function rawBodyMiddleware(req: Request, res: Response, next: NextFunction) {
  next();
}