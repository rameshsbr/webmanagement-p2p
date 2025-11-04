import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { merchantHmacAuth } from '../middleware/hmac.js';
import { withIdempotency } from '../services/idempotency.js';
import { generateReference } from '../services/reference.js';
import { tgNotify } from '../services/telegram.js';
import { open, tscmp } from '../services/secretBox.js';
import { applyMerchantLimits } from '../middleware/merchantLimits.js';

const uploadDir = path.join(process.cwd(), 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 10 * 1024 * 1024 } });

export const merchantApiRouter = Router();

/* ────────────────────────────────────────────────────────────────────────────
   API Key auth: Authorization: Bearer <prefix>.<secret>  (or X-API-Key)
   Optional integrity: X-Signature = hex(HMAC-SHA256(rawBody, <secret>))
   Scopes: enforced only when the caller uses API keys (HMAC flow unchanged)
──────────────────────────────────────────────────────────────────────────── */

type VerifiedKey = {
  merchantId: string;
  keyId: string;
  scopes: string[];
};

function readApiKeyHeader(req: any): { prefix: string; secret: string } | null {
  const raw = String(req.get('authorization') || req.get('x-api-key') || '');
  const m = raw.match(/(?:Bearer\s+)?([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{20,})/);
  if (!m) return null;
  return { prefix: m[1], secret: m[2] };
}

async function verifyApiKey(req: any): Promise<VerifiedKey | null> {
  const pk = readApiKeyHeader(req);
  if (!pk) return null;

  const rec = await prisma.merchantApiKey.findUnique({ where: { prefix: pk.prefix } });
  if (!rec || !rec.active) return null;
  if (rec.expiresAt && rec.expiresAt < new Date()) return null;

  let stored: string;
  try {
    stored = open(rec.secretEnc);
  } catch {
    return null;
  }
  if (!tscmp(stored, pk.secret)) return null;

  // Optional request HMAC integrity
  const sig = req.get('x-signature');
  if (sig && req.rawBody) {
    const mac = crypto.createHmac('sha256', pk.secret).update(req.rawBody).digest('hex');
    if (!tscmp(sig, mac)) return null;
  }

  // touch lastUsedAt asynchronously
  prisma.merchantApiKey
    .update({ where: { id: rec.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { merchantId: rec.merchantId, keyId: rec.id, scopes: rec.scopes ?? [] };
}

/** Attach merchant via API key *or* fall back to HMAC. */
async function eitherMerchantAuth(req: any, res: any, next: any) {
  const ok = await verifyApiKey(req);
  if (ok) {
    req.merchantId = ok.merchantId;
    req.apiKeyScopes = ok.scopes as string[];
    return next();
  }
  // Fallback to your existing HMAC middleware (unchanged behavior)
  return merchantHmacAuth(req, res, next);
}

/** Require API key explicitly (no HMAC fallback) */
async function apiKeyOnly(req: any, res: any, next: any) {
  const ok = await verifyApiKey(req);
  if (!ok) return res.status(401).json({ ok: false, error: 'API key required' });
  req.merchantId = ok.merchantId;
  req.apiKeyScopes = ok.scopes as string[];
  next();
}

/** If the request used API key auth, enforce the required scopes. */
function requireApiScopes(required: string[]) {
  const requiredSet = new Set(required);
  return function (req: any, res: any, next: any) {
    const scopes: string[] | undefined = req.apiKeyScopes;
    if (!scopes) return next(); // HMAC path → no scope enforcement
    const hasAll = Array.from(requiredSet).every((s) => scopes.includes(s));
    if (!hasAll) return res.status(403).json({ ok: false, error: 'Insufficient API scope' });
    next();
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   EXISTING ENDPOINTS (behavior unchanged w/ HMAC); when called with API key:
   - MerchantLimits (IP allow list + rate limit) enforced
   - Scopes enforced where specified
   - Payer blocklist enforced on create flows
──────────────────────────────────────────────────────────────────────────── */

// Create a deposit intent and show bank details
merchantApiRouter.post(
  '/deposit/intents',
  eitherMerchantAuth,
  applyMerchantLimits,
  requireApiScopes(['write:deposit']),
  async (req, res) => {
    const schema = z.object({
      user: z.object({ diditSubject: z.string() }),
      amountCents: z.number().int().positive(),
      currency: z.string().min(3).max(4),
    });
    const body = schema.parse(req.body);
    const merchantId = (req as any).merchantId as string;
    const scope = `deposit:${merchantId}:${body.user.diditSubject}`;
    const idemKey = req.header('Idempotency-Key') ?? undefined;

    const result = await withIdempotency(scope, idemKey, async () => {
      const user = await prisma.user.upsert({
        where: { diditSubject: body.user.diditSubject },
        create: { diditSubject: body.user.diditSubject, verifiedAt: new Date() },
        update: {},
      });

      if (!user.verifiedAt) throw new Error('User not verified');

      // Blocklist check (merchant + user)
      const blocked = await prisma.payerBlocklist.findFirst({
        where: { merchantId, userId: user.id, active: true },
        select: { id: true },
      });
      if (blocked) throw new Error('User is blocked');

      const bank = await prisma.bankAccount.findFirst({
        where: { active: true, merchantId: null, currency: body.currency },
      });
      if (!bank) throw new Error('No active bank account for currency');

      const referenceCode = generateReference('DEP');
      const pr = await prisma.paymentRequest.create({
        data: {
          type: 'DEPOSIT',
          status: 'PENDING',
          amountCents: body.amountCents,
          currency: body.currency,
          referenceCode,
          merchantId,
          userId: user.id,
          bankAccountId: bank.id,
        },
      });
      await tgNotify(
        `🟢 New DEPOSIT intent\nRef: <b>${referenceCode}</b>\nAmount: ${body.amountCents} ${body.currency}`
      );
      return {
        id: pr.id,
        referenceCode,
        bankDetails: {
          holderName: bank.holderName,
          bankName: bank.bankName,
          accountNo: bank.accountNo,
          iban: bank.iban,
          instructions: bank.instructions,
        },
      };
    });

    res.ok(result);
  }
);

// Attach receipt to deposit (append; non-destructive)
merchantApiRouter.post(
  '/deposit/:id/receipt',
  eitherMerchantAuth,
  applyMerchantLimits,
  requireApiScopes(['write:deposit']),
  upload.single('receipt'),
  async (req, res) => {
    const id = req.params.id;
    if (!req.file) return res.badRequest('Missing file');

    // ensure payment exists & belongs to the current merchant
    const pr = await prisma.paymentRequest.findUnique({
      where: { id },
      select: { id: true, merchantId: true, referenceCode: true, receiptFileId: true },
    });
    if (!pr) return res.notFound ? res.notFound() : res.status(404).json({ ok: false, error: 'Not found' });
    if (req.merchantId && pr.merchantId !== req.merchantId) {
      return res.forbidden ? res.forbidden('Wrong merchant') : res.status(403).json({ ok: false, error: 'Forbidden' });
    }

    const relPath = '/uploads/' + path.basename(req.file.path);

    // Create + link via new multi-receipt relation; keep legacy pointer if first time
    const created = await prisma.receiptFile.create({
      data: {
        original: req.file.originalname,
        path: relPath,
        mimeType: req.file.mimetype,
        size: req.file.size,
        // link through the new relation (ReceiptFile.paymentV2 → PaymentRequest.id)
        paymentV2: { connect: { id: pr.id } },
      },
      select: { id: true },
    });

    await prisma.paymentRequest.update({
      where: { id: pr.id },
      data: {
        status: 'SUBMITTED',
        ...(pr.receiptFileId ? {} : { receiptFileId: created.id }), // back-compat: set legacy pointer once
      },
    });

    await tgNotify(`📄 Deposit SUBMITTED\nRef: <b>${pr.referenceCode}</b>`);
    res.ok({ uploaded: true, fileId: created.id });
  }
);

// Create withdrawal request
merchantApiRouter.post(
  '/withdrawals',
  eitherMerchantAuth,
  applyMerchantLimits,
  requireApiScopes(['write:withdrawal']),
  async (req, res) => {
    const schema = z.object({
      user: z.object({ diditSubject: z.string() }),
      amountCents: z.number().int().positive(),
      currency: z.string().min(3).max(4),
      destination: z.object({
        bankName: z.string(),
        holderName: z.string(),
        accountNo: z.string(),
        iban: z.string().optional(),
      }),
    });
    const body = schema.parse(req.body);
    const merchantId = (req as any).merchantId as string;

    const user = await prisma.user.findUnique({ where: { diditSubject: body.user.diditSubject } });
    if (!user || !user.verifiedAt) return res.forbidden('User not verified');

    // Blocklist check (merchant + user)
    const blocked = await prisma.payerBlocklist.findFirst({
      where: { merchantId, userId: user.id, active: true },
      select: { id: true },
    });
    if (blocked) return res.forbidden('User is blocked');

    const hasDeposit = await prisma.paymentRequest.findFirst({
      where: { userId: user.id, merchantId, type: 'DEPOSIT', status: 'APPROVED' },
    });
    if (!hasDeposit) return res.forbidden('Withdrawal blocked: no prior deposit');

    const dest = await prisma.withdrawalDestination.create({
      data: { userId: user.id, currency: body.currency, ...body.destination },
    });

    const referenceCode = generateReference('WDR');
    const pr = await prisma.paymentRequest.create({
      data: {
        type: 'WITHDRAWAL',
        status: 'PENDING',
        amountCents: body.amountCents,
        currency: body.currency,
        referenceCode,
        merchantId,
        userId: user.id,
        detailsJson: { destinationId: dest.id },
      },
    });
    await tgNotify(
      `🟡 New WITHDRAWAL request\nRef: <b>${referenceCode}</b>\nAmount: ${body.amountCents} ${body.currency}`
    );
    res.ok({ id: pr.id, referenceCode });
  }
);

/* ────────────────────────────────────────────────────────────────────────────
   New, API-key-only, read-only endpoint with scopes
──────────────────────────────────────────────────────────────────────────── */

merchantApiRouter.get(
  '/v1/payments',
  apiKeyOnly,
  applyMerchantLimits,
  requireApiScopes(['read:payments']),
  async (req: any, res) => {
    const items = await prisma.paymentRequest.findMany({
      where: { merchantId: req.merchantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        referenceCode: true,
        type: true,
        status: true,
        amountCents: true,
        currency: true,
        createdAt: true,
      },
    });
    res.json({ ok: true, items });
  }
);