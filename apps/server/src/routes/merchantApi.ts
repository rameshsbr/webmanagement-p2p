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

function dbg(req: any, ...args: any[]) {
  const on = req?.query?.debug === '1' || process.env.PROVIDER_LOG === '1';
  if (on) console.log('[merchantApi]', ...args);
}

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

/* ────────────────────────────────────────────────────────────────────────────
   EXISTING ENDPOINTS (behavior unchanged w/ HMAC); with API keys we enforce:
   - MerchantLimits
   - Scopes (if scopes present)
   - Payer blocklist
──────────────────────────────────────────────────────────────────────────── */

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
      methodCode: z.string().optional(),    // optional
      bankCode: z.string().optional(),      // optional, required for VA
    });
    const body = schema.parse(req.body);
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

        // pick desired method
        const desiredCode = (body.methodCode || allowedCodes[0] || '').toUpperCase();
        if (!desiredCode) throw new Error('METHOD_NOT_ALLOWED');

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

        const methodRecord = await ensureMerchantMethod(merchantId, bank.method || '');
        if (!methodRecord) throw new Error('METHOD_NOT_ALLOWED');

        const referenceCode = generateTransactionId();
        const uniqueReference = generateUniqueReference();

        // create PaymentRequest
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

        // If method is ID VA → call provider adapter now
        const providerRes = resolveProviderByMethodCode(desiredCode);
        if (providerRes) {
          const adapter = adapters[providerRes.adapterName];
          if (!adapter) throw new Error('Provider adapter missing');

          const fullName = user.fullName || user.firstName || "ACCOUNT HOLDER";
          dbg(req, '→ calling adapter.createDepositIntent', {
            merchantId,
            desiredCode,
            tid: referenceCode,
            amountCents: body.amountCents,
            currency: body.currency,
            bankCode: body.bankCode || 'BCA',
            uid: user.publicId,
          });

          const deposit = await adapter.createDepositIntent({
            tid: referenceCode,
            uid: user.publicId,
            merchantId,
            methodCode: desiredCode,
            amountCents: body.amountCents,
            currency: body.currency,
            bankCode: body.bankCode || 'BCA',
            kyc: { fullName: String(fullName), diditSubject: user.diditSubject || "" },
          });

          dbg(req, '← adapter.createDepositIntent OK', {
            providerPaymentId: deposit?.providerPaymentId,
            expiresAt: deposit?.expiresAt,
            va: deposit?.va,
          });

          // Validate minimum required adapter response
          if (!deposit || !deposit.providerPaymentId) {
            dbg(req, '!! adapter missing providerPaymentId, deposit=', deposit);
            throw new Error('ADAPTER_INVALID_RESPONSE');
          }

          // Normalize to strings to satisfy Prisma validation
          const vaBank = deposit.va?.bankCode ?? null;
          const vaNoRaw = deposit.va?.accountNo ?? null;
          const vaNameRaw = deposit.va?.accountName ?? null;
          const vaNo = vaNoRaw == null ? null : String(vaNoRaw);
          const vaName = vaNameRaw == null ? null : String(vaNameRaw);

          // Try to create ProviderPayment; if unique conflict on paymentRequestId, update instead
          try {
            const created = await prisma.providerPayment.create({
              data: {
                paymentRequestId: pr.id,
                provider: 'FAZZ',
                providerPaymentId: String(deposit.providerPaymentId),
                methodType: 'virtual_bank_account',
                bankCode: vaBank ? String(vaBank) : null,
                accountNumber: vaNo,
                accountName: vaName,
                expiresAt: deposit.expiresAt ? new Date(deposit.expiresAt) : null,
                status: 'pending',
                instructionsJson: deposit.instructions ?? {},
                rawCreateJson: deposit,
              },
            });
            dbg(req, '✓ ProviderPayment created', { id: created.id, paymentRequestId: pr.id });
          } catch (e: any) {
            // Handle unique conflicts (idempotency re-hit) and surface true reason
            const code = e?.code || e?.name;
            dbg(req, '✗ ProviderPayment create failed', { code, message: e?.message, meta: e?.meta });

            if (code === 'P2002') {
              // Unique constraint (paymentRequestId). Update in place.
              dbg(req, '… attempting update due to unique conflict');
              await prisma.providerPayment.update({
                where: { paymentRequestId: pr.id },
                data: {
                  providerPaymentId: String(deposit.providerPaymentId),
                  bankCode: vaBank ? String(vaBank) : null,
                  accountNumber: vaNo,
                  accountName: vaName,
                  expiresAt: deposit.expiresAt ? new Date(deposit.expiresAt) : null,
                  status: 'pending',
                  instructionsJson: deposit.instructions ?? {},
                  rawCreateJson: deposit,
                },
              });
            } else {
              // Re-throw so the caller returns reason=PROVIDER_PERSIST_FAILED
              (e as any).__persist = true;
              throw e;
            }
          }

          await tgNotify(
            `🟢 New DEPOSIT intent (ID VA)\nRef: <b>${referenceCode}</b>\nAmount: ${body.amountCents} ${body.currency}`
          );

          return {
            id: pr.id,
            referenceCode,
            instructions: deposit.instructions,
            va: deposit.va,
            expiresAt: deposit.expiresAt || null,
          };
        }

        // fallback (legacy, static bank details)
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

      res.ok({ ok: true, data: result });
    } catch (err: any) {
      const message = err?.message || '';
      dbg(req, 'deposit/intents error', { message, code: err?.code, meta: err?.meta, stack: err?.stack });

      if (message === 'NO_METHOD') return res.status(400).json({ ok: false, error: 'No methods assigned' });
      if (message === 'METHOD_NOT_ALLOWED') return res.status(400).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
      if (message === 'CLIENT_INACTIVE') return res.forbidden('Client is blocked or deactivated');
      if (message === 'User is blocked') return res.forbidden('User is blocked');

      // If our create failed due to Prisma persist, surface a stable reason
      if (err?.__persist === true) {
        return res.status(400).json({ ok: false, error: 'Unable to create deposit intent', reason: 'PROVIDER_PERSIST_FAILED' });
      }
      if (message === 'ADAPTER_INVALID_RESPONSE') {
        return res.status(400).json({ ok: false, error: 'Unable to create deposit intent', reason: 'ADAPTER_INVALID_RESPONSE' });
      }

      return res.status(400).json({ ok: false, error: 'Unable to create deposit intent' });
    }
  }
);

// Confirm a deposit (poll provider & update local status)
merchantApiRouter.post(
  '/deposit/confirm',
  apiKeyOnly,
  requireApiScopes(['write:deposit', 'read:deposit']),
  async (req, res) => {
    const schema = z.object({
      id: z.string().optional(),
      referenceCode: z.string().optional(),
    }).refine(v => v.id || v.referenceCode, { message: 'id or referenceCode is required' });

    const body = schema.parse(req.body);
    const merchantId = (req as any).merchantId as string;

    const where = body.id
      ? { id: body.id, merchantId, type: 'DEPOSIT' as const }
      : { referenceCode: body.referenceCode!, merchantId, type: 'DEPOSIT' as const };

    const pr = await prisma.paymentRequest.findFirst({ where });
    if (!pr) return res.status(404).json({ ok: false, error: 'Not found' });

    const pp = await prisma.providerPayment.findUnique({
      where: { paymentRequestId: pr.id },
    });

    if (!pp) {
      return res.json({ ok: true, id: pr.id, referenceCode: pr.referenceCode, status: pr.status });
    }

    const methodCode = String(pr.detailsJson?.method || '');
    const providerRes = resolveProviderByMethodCode(methodCode);
    if (!providerRes) {
      return res.json({ ok: true, id: pr.id, referenceCode: pr.referenceCode, status: pr.status, provider: { status: pp.status } });
    }

    const adapter = adapters[providerRes.adapterName];
    if (!adapter) {
      return res.json({ ok: true, id: pr.id, referenceCode: pr.referenceCode, status: pr.status, provider: { status: pp.status } });
    }

    const { status: providerStatus, raw } = await adapter.getDepositStatus(pp.providerPaymentId);

    let newStatus: 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | null = null;
    const normalized = String(providerStatus || '').toLowerCase();
    if (normalized === 'paid' || normalized === 'completed' || normalized === 'success' || normalized === 'succeeded') {
      newStatus = 'APPROVED';
    } else if (normalized === 'failed' || normalized === 'cancelled' || normalized === 'canceled' || normalized === 'rejected' || normalized === 'expired') {
      newStatus = 'REJECTED';
    } else {
      newStatus = null;
    }

    await prisma.providerPayment.update({
      where: { paymentRequestId: pr.id },
      data: { status: providerStatus, rawLatestJson: raw ?? {} },
    });

    if (newStatus && newStatus !== pr.status) {
      await prisma.paymentRequest.update({
        where: { id: pr.id },
        data: { status: newStatus },
      });
    }

    return res.json({
      ok: true,
      id: pr.id,
      referenceCode: pr.referenceCode,
      status: newStatus || pr.status,
      provider: { status: providerStatus, raw },
    });
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

// Create withdrawal request (unchanged for now)
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

    const mapping = await upsertMerchantClientMapping({ merchantId, userId: user.id });
    const clientStatus = normalizeClientStatus(mapping?.status);
    if (clientStatus !== 'ACTIVE') return res.forbidden('Client is blocked or deactivated');

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

// Helper: check a provider status for a payment
merchantApiRouter.get(
  '/deposit/:id/status',
  apiKeyOnly,
  requireApiScopes(['read:deposit']),
  async (req, res) => {
    const pr = await prisma.paymentRequest.findUnique({
      where: { id: req.params.id },
    });

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
