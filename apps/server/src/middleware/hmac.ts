import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';

export async function merchantHmacAuth(req: Request, res: Response, next: NextFunction) {
  const publicKey = req.header('X-Public-Key');
  const signature = req.header('X-Signature');
  const timestamp = req.header('X-Timestamp');
  if (!publicKey || !signature || !timestamp) return res.unauthorized('Missing auth headers');

  const apiKey = await prisma.merchantApiKey.findUnique({ where: { publicKey } });
  if (!apiKey || !apiKey.enabled) return res.unauthorized('Invalid key');

  // 5 min skew window
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts) || Math.abs(now - ts) > 300) return res.unauthorized('Stale timestamp');

  // Sign raw body string
  const rawBody = (req as any)._rawBody ?? JSON.stringify(req.body ?? {});
  const hmac = crypto.createHmac('sha256', apiKey.secretHash);
  hmac.update(`${timestamp}.${rawBody}`);
  const expected = hmac.digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.unauthorized('Bad signature');
  }
  (req as any).merchantId = apiKey.merchantId;
  next();
}
