import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { open, tscmp } from '../services/secretBox.js';

function readPrefix(req: Request): string | null {
  const rawPublic = req.header('X-Public-Key')?.trim();
  if (rawPublic) {
    const dot = rawPublic.indexOf('.');
    return dot >= 0 ? rawPublic.slice(0, dot) : rawPublic;
  }
  const auth = req.header('authorization') || req.header('x-api-key');
  if (!auth) return null;
  const m = auth.match(/(?:Bearer\s+)?([A-Za-z0-9_-]+)(?:\.[A-Za-z0-9_-]{10,})?/);
  return m ? m[1] : null;
}

export async function merchantHmacAuth(req: Request, res: Response, next: NextFunction) {
  const prefix = readPrefix(req);
  const signature = req.header('X-Signature');
  const timestamp = req.header('X-Timestamp');
  if (!prefix || !signature || !timestamp) return res.unauthorized('Missing auth headers');

  const apiKey = await prisma.merchantApiKey.findUnique({
    where: { prefix },
    include: { merchant: { select: { active: true, status: true } } },
  });
  if (!apiKey || !apiKey.active) return res.unauthorized('Invalid key');
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return res.unauthorized('Key expired');

  let secret: string;
  try {
    secret = open(apiKey.secretEnc);
  } catch {
    return res.unauthorized('Invalid key');
  }

  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts) || Math.abs(now - ts) > 300) return res.unauthorized('Stale timestamp');

  const rawBody = (req.rawBody as string | undefined)
    ?? ((req as any)._rawBody as string | undefined)
    ?? JSON.stringify(req.body ?? {});
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  if (!tscmp(signature, expected)) {
    return res.unauthorized('Bad signature');
  }

  const merchantStatus = String(apiKey.merchant?.status || '').toLowerCase();
  if (!apiKey.merchant?.active || merchantStatus === 'suspended' || merchantStatus === 'closed') {
    return res.unauthorized('Merchant inactive');
  }

  req.merchantId = apiKey.merchantId;
  next();
}
