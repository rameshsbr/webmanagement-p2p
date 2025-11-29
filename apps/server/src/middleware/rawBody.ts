// apps/server/src/middleware/rawBody.ts
import type { Request, Response, NextFunction } from "express";

/**
 * This function is passed into express.json({ verify }) and express.urlencoded({ verify })
 * It captures the raw request body BEFORE parsing.
 */
export function captureRawBody(req: Request, _res: Response, buf: Buffer, encoding: BufferEncoding) {
  if (buf && buf.length) {
    const raw = buf.toString(encoding || "utf8");
    (req as any)._rawBody = raw;
    (req as any).rawBody = raw;
  }
}

/**
 * This middleware must do NOTHING.  
 * It's only here so that Express loads the verify callback.
 */
export function rawBodyMiddleware(_req: Request, _res: Response, next: NextFunction) {
  next();
}