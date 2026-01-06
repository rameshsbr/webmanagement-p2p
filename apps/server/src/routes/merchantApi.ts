import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

import { prisma } from '../lib/prisma.js';
import { merchantHmacAuth } from '../middleware/hmac.js';
import { withIdempotency } from '../services/idempotency.js';
import { generateTransactionId, generateUniqueReference, generateUserId } from '../services/reference.js';
import { tgNotify } from '../services/telegram.js';
import { open, tscmp } from '../services/secretBox.js';
import { applyMerchantLimits } from '../middleware/merchantLimits.js';
import { normalizeClientStatus, upsertMerchantClientMapping, type ClientStatus } from '../services/merchantClient.js';
import { ensureMerchantMethod, listMerchantMethods, resolveProviderByMethodCode } from '../services/methods.js';
import { adapters } from '../services/providers/index.js';

const uploadDir = path.join(process.cwd(), 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 10 * 1024 * 1024 } });

export const merchantApiRouter = Router();

/* ───────────────── helpers ───────────────── */

function rejectForClientStatus(res: any, status: ClientStatus) {
  const message = status === 'BLOCKED' ? 'User is blocked' : 'User is deactivated';
  return res.forbidden ? res.forbidden(message) : res.status(403).json({ ok: false, error: message });
}

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

  const rec = await prisma.merchantApiKey.findUnique({
    where: { prefix: pk.prefix },
    include: { merchant: { select: { id: true, active: true, status: true } } },
  });
  if (!rec || !rec.active) return null;
  if (rec.expiresAt && rec.expiresAt < new Date()) return null;

  let stored: string;
  try {
    stored = open(rec.secretEnc);
  } catch {
    return null;
  }
  if (!tscmp(stored, pk.secret)) return null;

  const merchantStatus = String(rec.merchant?.status || '').toLowerCase();
  if (!rec.merchant?.active || merchantStatus === 'suspended' || merchantStatus === 'closed') {
    return null;
  }

  const sig = req.get('x-signature');
  if (sig && req.rawBody) {
    const mac = crypto.createHmac('sha256', pk.secret).update(req.rawBody).digest('hex');
    if (!tscmp(sig, mac)) return null;
  }

  prisma.merchantApiKey
    .update({ where: { id: rec.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { merchantId: rec.merchantId, keyId: rec.id, scopes: rec.scopes ?? [] };
}

async function eitherMerchantAuth(req: any, res: any, next: any) {
  const ok = await verifyApiKey(req);
  if (ok) {
    req.merchantId = ok.merchantId;
    req.apiKeyScopes = ok.scopes as string[];
    return next();
  }
  return merchantHmacAuth(req, res, next);
}

async function apiKeyOnly(req: any, res: any, next: any) {
  const ok = await verifyApiKey(req);
  if (!ok) return res.status(401).json({ ok: false, error: 'API key required' });
  req.merchantId = ok.merchantId;
  req.apiKeyScopes = ok.scopes as string[];
  next();
}

function requireApiScopes(required: string[]) {
  const requiredSet = new Set(required);
  return function (req: any, res: any, next: any) {
    const scopes: string[] | undefined = req.apiKeyScopes;
    if (!scopes) return next();
    const hasAll = Array.from(requiredSet).every((s) => scopes.includes(s));
    if (!hasAll) return res.status(403).json({ ok: false, error: 'Insufficient API scope' });
    next();
  };
}

/* ───────────────── EXISTING ENDPOINTS (kept, with provider support) ───────────────── */

// Create a deposit intent and show provider instructions (ID VA static/dynamic)
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
      methodCode: z.string().optional(), // optional
      bankCode: z.string().optional(),   // optional, required for VA
    });

    let body: z.infer<typeof schema>;
    try {
      body = schema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: 'Invalid request body' });
    }

    const merchantId = (req as any).merchantId as string;
    const scope = `deposit:${merchantId}:${body.user.diditSubject}`;
    const idemKey = req.header('Idempotency-Key') ?? undefined;

    try {
      const result = await withIdempotency(scope, idemKey, async () => {
        // ensure user
        const user = await prisma.user.upsert({
          where: { diditSubject: body.user.diditSubject },
          create: { publicId: generateUserId(), diditSubject: body.user.diditSubject, verifiedAt: new Date() },
          update: {},
        });
        if (!user.verifiedAt) throw new Error('User not verified');

        // merchant-client mapping & blocklist
        const mapping = await upsertMerchantClientMapping({ merchantId, userId: user.id });
        const clientStatus = normalizeClientStatus(mapping?.status);
        if (clientStatus !== 'ACTIVE') throw new Error('CLIENT_INACTIVE');
        const blocked = await prisma.payerBlocklist.findFirst({
          where: { merchantId, userId: user.id, active: true },
          select: { id: true },
        });
        if (blocked) throw new Error('User is blocked');

        // methods allowed
        const allowedMethods = await listMerchantMethods(merchantId);
        const allowedCodes = allowedMethods.map((m) => m.code.trim().toUpperCase());
        if (!allowedCodes.length) throw new Error('NO_METHOD');

        // pick desired method (optional in request, otherwise first allowed)
        const desiredCode = (body.methodCode || allowedCodes[0] || '').toUpperCase();
        if (!desiredCode || !allowedCodes.includes(desiredCode)) throw new Error('METHOD_NOT_ALLOWED');

        // select a bank account "template" row by currency+method (prefer merchant row)
        const bank = await prisma.bankAccount.findFirst({
          where: {
            active: true,
            currency: body.currency,
            OR: [{ merchantId }, { merchantId: null }],
            method: { in: [desiredCode] },
          },
          orderBy: [{ merchantId: 'desc' }, { createdAt: 'desc' }],
        });
        if (!bank) throw new Error('No active bank account for currency/method');

        // ensure method link row exists/enabled
        const methodRecord = await ensureMerchantMethod(merchantId, bank.method || '');
        if (!methodRecord) throw new Error('METHOD_NOT_ALLOWED');

        const referenceCode = generateTransactionId();
        const uniqueReference = generateUniqueReference();

        // create PaymentRequest first (status=PENDING)
        const pr = await prisma.paymentRequest.create({
          data: {
            type: 'DEPOSIT',
            status: 'PENDING',
            amountCents: body.amountCents,
            currency: body.currency,
            referenceCode,
            uniqueReference,
            merchantId,
            userId: user.id,
            bankAccountId: bank.id,
            methodId: methodRecord.id,
            detailsJson: { method: bank.method, reqBankCode: body.bankCode || null },
          },
        });

        // If method is supported by a provider → call adapter now
        const providerRes = resolveProviderByMethodCode(desiredCode);
        if (providerRes) {
          const adapter = adapters[providerRes.adapterName];
          if (!adapter) throw new Error('Provider adapter missing');

          const fullName = (user.fullName || user.firstName || 'ACCOUNT HOLDER').toString();

          let deposit;
          try {
            deposit = await adapter.createDepositIntent({
              tid: referenceCode,
              uid: user.publicId,
              merchantId,
              methodCode: desiredCode,
              amountCents: body.amountCents,
              currency: body.currency,
              bankCode: body.bankCode || 'BCA', // default for testing
              kyc: { fullName: fullName, diditSubject: user.diditSubject || '' },
            });
          } catch (e: any) {
            // ensure we keep PR but surface a clear error
            await tgNotify(`❌ Provider error creating deposit\nRef: <b>${referenceCode}</b>\n${e?.message || e}`);
            throw new Error('PROVIDER_CREATE_FAILED');
          }

          // persist ProviderPayment
          await prisma.providerPayment.create({
            data: {
              paymentRequestId: pr.id,
              provider: providerRes.provider, // e.g. 'FAZZ'
              providerPaymentId: deposit.providerPaymentId,
              methodType: 'virtual_bank_account',
              bankCode: deposit.va.bankCode,
              accountNumber: deposit.va.accountNo,
              accountName: deposit.va.accountName,
              expiresAt: deposit.expiresAt ? new Date(deposit.expiresAt) : null,
              status: 'pending',
              instructionsJson: deposit.instructions,
              rawCreateJson: deposit,
            },
          });

          await tgNotify(
            `🟢 New DEPOSIT intent (provider)\nRef: <b>${referenceCode}</b>\nAmount: ${body.amountCents} ${body.currency}`
          );

          return {
            id: pr.id,
            referenceCode,
            instructions: deposit.instructions,
            va: deposit.va,
            expiresAt: deposit.expiresAt || null,
          };
        }

        // fallback: legacy static bank details (no provider)
        await tgNotify(
          `🟢 New DEPOSIT intent (legacy)\nRef: <b>${referenceCode}</b>\nAmount: ${body.amountCents} ${body.currency}`
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

      res.ok({ ok: true, data: result });
    } catch (err: any) {
      const message = String(err?.message || '');
      if (message === 'NO_METHOD') return res.status(400).json({ ok: false, error: 'No methods assigned' });
      if (message === 'METHOD_NOT_ALLOWED') return res.status(400).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
      if (message === 'CLIENT_INACTIVE') return rejectForClientStatus(res, 'DEACTIVATED');
      if (message === 'User is blocked') return rejectForClientStatus(res, 'BLOCKED');
      if (message === 'PROVIDER_CREATE_FAILED') return res.status(400).json({ ok: false, error: 'Provider failed to create VA' });
      return res.status(400).json({ ok: false, error: 'Unable to create deposit intent' });
    }
  }
);

// Confirm/poll a provider-backed deposit by PaymentRequest ID or referenceCode
// Body: { id?: string; referenceCode?: string }
merchantApiRouter.post(
  '/deposit/confirm',
  apiKeyOnly,
  requireApiScopes(['read:deposit']),
  async (req, res) => {
    const schema = z.object({
      id: z.string().optional(),
      referenceCode: z.string().optional(),
    }).refine((v) => Boolean(v.id || v.referenceCode), { message: 'id or referenceCode required' });

    let body: z.infer<typeof schema>;
    try {
      body = schema.parse(req.body);
    } catch {
      return res.status(400).json({ ok: false, error: 'Invalid request body' });
    }

    const where = body.id ? { id: body.id } : { referenceCode: body.referenceCode! };
    const pr = await prisma.paymentRequest.findFirst({
      where: { ...where, merchantId: req.merchantId, type: 'DEPOSIT' },
      include: { providerPayment: true as any },
    }) as any;

    if (!pr) return res.status(404).json({ ok: false, error: 'Not found' });

    const methodCode = (pr.detailsJson?.method || '').toString();
    const providerRes = resolveProviderByMethodCode(methodCode);
    if (!providerRes || !pr.providerPayment) {
      // legacy path: nothing to poll; just return current local status
      return res.json({ ok: true, status: pr.status, provider: null });
    }

    const adapter = adapters[providerRes.adapterName];
    if (!adapter) return res.status(500).json({ ok: false, error: 'Provider adapter not available' });

    try {
      const { status, raw } = await adapter.getDepositStatus(pr.providerPayment.providerPaymentId);

      // Map provider → local. IMPORTANT: do NOT use SETTLED (not in enum).
      // We'll keep APPROVED as terminal success.
      let newStatus: 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' = pr.status;
      const s = status.toLowerCase();
      if (s === 'paid' || s === 'completed' || s === 'success') newStatus = 'APPROVED';
      else if (s === 'pending' || s === 'awaiting_payment') newStatus = 'PENDING';
      else if (s === 'expired' || s === 'cancelled' || s === 'failed') newStatus = 'REJECTED';

      if (newStatus !== pr.status) {
        await prisma.paymentRequest.update({
          where: { id: pr.id },
          data: { status: newStatus, updatedAt: new Date() },
        });
      }
      await prisma.providerPayment.update({
        where: { paymentRequestId: pr.id },
        data: { status, rawLatestJson: raw ?? {} },
      });

      return res.json({ ok: true, status: newStatus, provider: { status, raw } });
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: e?.message || 'Unable to confirm deposit' });
    }
  }
);

// Attach receipt (unchanged; uses multi-receipts)
merchantApiRouter.post(
  '/deposit/:id/receipt',
  eitherMerchantAuth,
  applyMerchantLimits,
  requireApiScopes(['write:deposit']),
  upload.single('receipt'),
  async (req, res) => {
    const id = req.params.id;
    if (!req.file) return res.badRequest('Missing file');

    const pr = await prisma.paymentRequest.findUnique({
      where: { id },
      select: { id: true, merchantId: true, referenceCode: true, receiptFileId: true },
    });
    if (!pr) return res.notFound ? res.notFound() : res.status(404).json({ ok: false, error: 'Not found' });
    if (req.merchantId && pr.merchantId !== req.merchantId) {
      return res.forbidden ? res.forbidden('Wrong merchant') : res.status(403).json({ ok: false, error: 'Forbidden' });
    }

    const relPath = '/uploads/' + path.basename(req.file.path);

    const created = await prisma.receiptFile.create({
      data: {
        original: req.file.originalname,
        path: relPath,
        mimeType: req.file.mimetype,
        size: req.file.size,
        paymentV2: { connect: { id: pr.id } },
      },
      select: { id: true },
    });

    await prisma.paymentRequest.update({
      where: { id: pr.id },
      data: {
        status: 'SUBMITTED',
        ...(pr.receiptFileId ? {} : { receiptFileId: created.id }),
      },
    });

    await tgNotify(`📄 Deposit SUBMITTED\nRef: <b>${pr.referenceCode}</b>`);
    res.ok({ uploaded: true, fileId: created.id });
  }
);

// Create withdrawal request (kept same; will use provider layer later)
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

    let body: z.infer<typeof schema>;
    try {
      body = schema.parse(req.body);
    } catch {
      return res.status(400).json({ ok: false, error: 'Invalid request body' });
    }

    const merchantId = (req as any).merchantId as string;

    const user = await prisma.user.findUnique({ where: { diditSubject: body.user.diditSubject } });
    if (!user || !user.verifiedAt) return res.forbidden('User not verified');

    const mapping = await upsertMerchantClientMapping({ merchantId, userId: user.id });
    const clientStatus = normalizeClientStatus(mapping?.status);
    if (clientStatus !== 'ACTIVE') return rejectForClientStatus(res, clientStatus);

    const allowedMethods = await listMerchantMethods(merchantId);
    const selectedMethod = allowedMethods[0] || null;
    if (!selectedMethod) return res.forbidden('No methods assigned');

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

    const referenceCode = generateTransactionId();
    const uniqueReference = generateUniqueReference();

    const pr = await prisma.paymentRequest.create({
      data: {
        type: 'WITHDRAWAL',
        status: 'PENDING',
        amountCents: body.amountCents,
        currency: body.currency,
        referenceCode,
        uniqueReference,
        merchantId,
        userId: user.id,
        methodId: selectedMethod.id,
        detailsJson: { method: selectedMethod.code, destinationId: dest.id },
      },
    });

    await tgNotify(
      `🟡 New WITHDRAWAL request\nRef: <b>${referenceCode}</b>\nAmount: ${body.amountCents} ${body.currency}`
    );
    res.ok({ id: pr.id, referenceCode, uniqueReference });
  }
);

// API-key-only listing (unchanged)
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
        uniqueReference: true,
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

// Helper: check a provider status for a payment (by ID)
merchantApiRouter.get(
  '/deposit/:id/status',
  apiKeyOnly,
  requireApiScopes(['read:deposit']),
  async (req, res) => {
    const pr = await prisma.paymentRequest.findUnique({
      where: { id: req.params.id },
      include: { providerPayment: true as any },
    }) as any;

    if (!pr || pr.merchantId !== req.merchantId) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }

    const pp = await prisma.providerPayment.findUnique({ where: { paymentRequestId: pr.id } });
    if (!pp) return res.json({ ok: true, status: pr.status, provider: null });

    const providerRes = resolveProviderByMethodCode((pr.detailsJson?.method || '').toString());
    if (!providerRes) return res.json({ ok: true, status: pr.status, provider: { status: pp.status } });

    const adapter = adapters[providerRes.adapterName];
    const { status, raw } = await adapter.getDepositStatus(pp.providerPaymentId);
    return res.json({ ok: true, status: pr.status, provider: { status, raw } });
  }
);
