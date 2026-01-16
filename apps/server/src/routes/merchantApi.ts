// apps/server/src/routes/merchantApi.ts
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
import { fazzGetBalance, mapFazzDisbursementStatusToPlatform, mapFazzPaymentStatusToPlatform } from '../services/providers/fazz.js';
import { API_KEY_SCOPES, normalizeApiKeyScopes } from '../services/apiKeyScopes.js';
import type { ApiKeyScope } from '../services/apiKeyScopes.js'; // <-- added

const uploadDir = path.join(process.cwd(), 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 10 * 1024 * 1024 } });

export const merchantApiRouter = Router();

/** ---- helper: reject-for-client-status ---- */
function rejectForClientStatus(res: any, status: ClientStatus) {
  const message = status === 'BLOCKED' ? 'User is blocked' : 'User is deactivated';
  return res.forbidden ? res.forbidden(message) : res.status(403).json({ ok: false, error: message });
}

/** ---- helper: API-key verification ---- */
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
  if (!rec.merchant?.active || ['suspended','closed'].includes(merchantStatus)) {
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

// CHANGED: use ApiKeyScope[] instead of string[]
function requireApiScopes(required: ApiKeyScope[]) {
  const requiredSet = new Set<ApiKeyScope>(required);
  return function (req: any, _res: any, next: any) {
    const scopes: string[] | undefined = req.apiKeyScopes;
    if (!scopes) return next();
    const normalizedScopes = normalizeApiKeyScopes(scopes); // ApiKeyScope[]
    const hasAll = Array.from(requiredSet).every((s) => normalizedScopes.includes(s));
    if (!hasAll) return _res.status(403).json({ ok: false, error: 'Insufficient API scope' });
    next();
  };
}

/** ---- helper: safe-JSON sanitizer for Prisma Json fields ---- */
function toJsonSafe<T = any>(value: T): any {
  const seen = new WeakSet();
  const replacer = (_key: string, v: any) => {
    if (v === undefined) return undefined;
    if (Number.isNaN(v) || v === Infinity || v === -Infinity) return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'bigint') return String(v);
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
    }
    return v;
  };
  try {
    return JSON.parse(JSON.stringify(value, replacer));
  } catch {
    try {
      return JSON.stringify(value, replacer);
    } catch {
      return null;
    }
  }
}

/** ---- helper: read method from Prisma JsonValue safely ---- */
function getMethodFromDetails(details: unknown): string {
  if (details && typeof details === "object" && "method" in (details as any)) {
    const m = (details as any).method;
    if (typeof m === "string") return m;
  }
  return "";
}

/** ---- NEW: provider status normalization + local mapping ---- */
type ProviderNorm = 'processing' | 'completed' | 'failed';
type LocalStatus = 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

function normalizeProviderStatus(s: unknown): ProviderNorm {
  const t = String(s || '').toLowerCase();
  if (['completed', 'success', 'succeeded'].includes(t)) return 'completed';
  if (['failed', 'rejected', 'cancelled', 'canceled', 'error'].includes(t)) return 'failed';
  return 'processing';
}

function mapProviderToLocal(p: ProviderNorm): LocalStatus {
  if (p === 'completed') return 'APPROVED';
  if (p === 'failed') return 'REJECTED';
  return 'PENDING';
}

function idrV4BankName(code: string | null | undefined): string {
  const map: Record<string, string> = {
    BCA: 'BCA',
    BRI: 'BRI',
    BNI: 'BNI',
    MANDIRI: 'Mandiri',
    CIMB_NIAGA: 'CIMB Niaga',
    DANAMON: 'Danamon',
    PERMATA: 'Permata',
    HANA: 'Hana',
    SAHABAT_SAMPOERNA: 'Bank Sahabat Sampoerna',
    BSI: 'Bank Syariah Indonesia',
  };
  const key = String(code || '').toUpperCase();
  return map[key] || key;
}

function normalizeIdrV4Deposit(result: any, amountCents: number) {
  const instructions = result?.instructions || {};
  const instrMethod =
    instructions?.paymentMethod?.instructions ||
    instructions?.method?.instructions ||
    instructions?.instructions ||
    instructions;
  const bankCode =
    result?.va?.bankCode ||
    instrMethod?.bankShortCode ||
    instrMethod?.bankCode ||
    instructions?.bankShortCode ||
    instructions?.bankCode ||
    null;
  const accountNo =
    result?.va?.accountNo ||
    instrMethod?.accountNo ||
    instructions?.accountNo ||
    null;
  const accountName =
    result?.va?.accountName ||
    instrMethod?.displayName ||
    instructions?.displayName ||
    null;
  const expiresAt = result?.expiresAt || result?.expiredAt || null;
  const uniqueRefNo =
    result?.va?.meta?.uniqueRefNo ||
    instructions?.meta?.uniqueRefNo ||
    instrMethod?.meta?.uniqueRefNo ||
    null;
  return {
    referenceCode: result?.referenceCode || null,
    amountCents,
    expiresAt,
    va: {
      bankCode: bankCode || null,
      bankName: bankCode ? idrV4BankName(bankCode) : null,
      accountNo: accountNo || null,
      accountName: accountName || null,
      meta: uniqueRefNo ? { uniqueRefNo } : undefined,
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   DEPOSITS (unchanged from your latest working version)
──────────────────────────────────────────────────────────────────────────── */

merchantApiRouter.post(
  '/deposit/intents',
  eitherMerchantAuth,
  applyMerchantLimits,
  requireApiScopes([API_KEY_SCOPES.IDRV4_ACCEPT]),
  async (req, res) => {
    const schema = z.object({
      user: z.object({ diditSubject: z.string() }),
      amountCents: z.number().int().positive(),
      currency: z.string().min(3).max(4),
      methodCode: z.string().optional(),
      bankCode: z.string().optional(),
    });
    const body = schema.parse(req.body);
    const merchantId = (req as any).merchantId as string;
    const scope = `deposit:${merchantId}:${body.user.diditSubject}`;
    const idemKey = req.header('Idempotency-Key') ?? undefined;
    const isDebug = String(req.query?.debug || '') === '1';

    try {
      const result = await withIdempotency(scope, idemKey, async () => {
        const user = await prisma.user.upsert({
          where: { diditSubject: body.user.diditSubject },
          create: { publicId: generateUserId(), diditSubject: body.user.diditSubject, verifiedAt: new Date() },
          update: {},
        });
        if (!user.verifiedAt) throw new Error('User not verified');

        const mapping = await upsertMerchantClientMapping({ merchantId, userId: user.id });
        const clientStatus = normalizeClientStatus(mapping?.status);
        if (clientStatus !== 'ACTIVE') throw new Error('CLIENT_INACTIVE');
        const blocked = await prisma.payerBlocklist.findFirst({
          where: { merchantId, userId: user.id, active: true },
          select: { id: true },
        });
        if (blocked) throw new Error('User is blocked');

        const allowedMethods = await listMerchantMethods(merchantId);
        const allowedCodes = allowedMethods.map((m) => m.code.trim().toUpperCase());
        if (!allowedCodes.length) throw new Error('NO_METHOD');

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

        const providerRes = resolveProviderByMethodCode(desiredCode);
        if (providerRes) {
          const adapter = adapters[providerRes.adapterName];
          if (!adapter) throw new Error('Provider adapter missing');

          const fullName = user.fullName || user.firstName || "ACCOUNT HOLDER";
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

          if (!deposit || !deposit.providerPaymentId || !deposit.va?.accountNo || !deposit.va?.bankCode) {
            const dbg = isDebug ? { depositSnapshot: toJsonSafe(deposit) } : undefined;
            const err = new Error('ADAPTER_BAD_RESPONSE');
            (err as any).code = 'ADAPTER_BAD_RESPONSE';
            (err as any).debug = dbg;
            throw err;
          }

          const instructionsJson = toJsonSafe(deposit.instructions);
          const rawCreateJson = toJsonSafe(deposit.raw ?? deposit);
          const providerStatus = String(deposit.status || "pending");
          const platformStatus = mapFazzPaymentStatusToPlatform(providerStatus);
          const meta = deposit.va?.meta || deposit.instructions?.meta || undefined;

          let pr: { id: string };
          try {
            const txResult = await prisma.$transaction(async (tx) => {
              const created = await tx.paymentRequest.create({
                data: {
                  type: 'DEPOSIT',
                  status: platformStatus,
                  amountCents: body.amountCents,
                  currency: body.currency,
                  referenceCode,
                  uniqueReference,
                  merchantId,
                  userId: user.id,
                  bankAccountId: bank.id,
                  methodId: methodRecord.id,
                  detailsJson: { method: bank.method, reqBankCode: body.bankCode || null, meta },
                },
                select: { id: true },
              });

              await tx.providerPayment.upsert({
                where: { providerPaymentId: String(deposit.providerPaymentId) },
                update: {
                  paymentRequestId: created.id,
                  provider: "FAZZ",
                  methodType: "virtual_bank_account",
                  bankCode: deposit.va.bankCode ?? null,
                  accountNumber: deposit.va.accountNo ?? null,
                  accountName: deposit.va.accountName ?? null,
                  expiresAt: deposit.expiresAt ? new Date(deposit.expiresAt) : null,
                  status: providerStatus,
                  instructionsJson,
                  rawCreateJson,
                },
                create: {
                  paymentRequestId: created.id,
                  provider: "FAZZ",
                  providerPaymentId: String(deposit.providerPaymentId),
                  methodType: "virtual_bank_account",
                  bankCode: deposit.va.bankCode ?? null,
                  accountNumber: deposit.va.accountNo ?? null,
                  accountName: deposit.va.accountName ?? null,
                  expiresAt: deposit.expiresAt ? new Date(deposit.expiresAt) : null,
                  status: providerStatus,
                  instructionsJson,
                  rawCreateJson,
                },
              });

              return { pr: created };
            });
            pr = txResult.pr;
          } catch (e: any) {
            const err = new Error('PROVIDER_PERSIST_FAILED');
            (err as any).cause = e;
            throw err;
          }

          await tgNotify(
            `🟢 New DEPOSIT intent (ID VA)\nRef: <b>${referenceCode}</b>\nAmount: ${body.amountCents} ${body.currency}`
          );

          const result = {
            id: pr.id,
            referenceCode,
            instructions: instructionsJson,
            va: {
              bankCode: deposit.va.bankCode,
              accountNo: deposit.va.accountNo,
              accountName: deposit.va.accountName,
            },
            expiresAt: deposit.expiresAt || null,
          } as any;

          if (desiredCode === 'VIRTUAL_BANK_ACCOUNT_DYNAMIC' || desiredCode === 'VIRTUAL_BANK_ACCOUNT_STATIC') {
            const normalized = normalizeIdrV4Deposit(result, body.amountCents);
            result.referenceCode = normalized.referenceCode || result.referenceCode;
            result.amountCents = normalized.amountCents;
            result.expiresAt = normalized.expiresAt || result.expiresAt;
            result.va = {
              bankCode: normalized.va.bankCode || result.va?.bankCode || null,
              bankName: normalized.va.bankName || null,
              accountNo: normalized.va.accountNo || result.va?.accountNo || null,
              accountName: normalized.va.accountName || result.va?.accountName || null,
              meta: normalized.va.meta || result.va?.meta || undefined,
            };
          }

          return result;
        }

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
        await tgNotify(`🟢 New DEPOSIT intent\nRef: <b>${referenceCode}</b>\nAmount: ${body.amountCents} ${body.currency}`);
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
      if (message === 'NO_METHOD') return res.status(400).json({ ok: false, error: 'No methods assigned' });
      if (message === 'METHOD_NOT_ALLOWED') return res.status(400).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
      if (message === 'CLIENT_INACTIVE') return res.forbidden('Client is blocked or deactivated');
      if (message === 'User is blocked') return res.forbidden('User is blocked');
      if (message === 'PROVIDER_PERSIST_FAILED') {
        const cause = err?.cause;
        return res.status(400).json({
          ok: false,
          error: 'Unable to create deposit intent',
          reason: 'PROVIDER_PERSIST_FAILED',
          ...(String(req.query?.debug || '') === '1'
            ? { prisma: { code: cause?.code, message: cause?.message, meta: cause?.meta } }
            : {}),
        });
      }
      if (err?.code === 'ADAPTER_BAD_RESPONSE') {
        return res.status(502).json({
          ok: false,
          error: 'Unable to create deposit intent',
          reason: 'ADAPTER_BAD_RESPONSE',
          ...(isDebug ? err?.debug || {} : {}),
        });
      }
      if (err?.providerError) {
        console.error("[DEPOSIT_INTENT_PROVIDER_ERROR]", err.providerError);
        return res.status(400).json({
          ok: false,
          error: 'Unable to create deposit intent',
          ...(isDebug ? { providerError: err.providerError } : {}),
        });
      }
      return res.status(400).json({ ok: false, error: 'Unable to create deposit intent' });
    }
  }
);

merchantApiRouter.post(
  '/deposit/confirm',
  apiKeyOnly,
  requireApiScopes([API_KEY_SCOPES.IDRV4_ACCEPT]),
  async (req, res) => {
    const schema = z.object({
      id: z.string().optional(),
      referenceCode: z.string().optional(),
    }).refine(v => v.id || v.referenceCode, { message: 'id or referenceCode is required' });

    const body = schema.parse(req.body);
    const merchantId = (req as any).merchantId as string;
    const isDebug = String(req.query?.debug || '') === '1';

    const where = body.id
      ? { id: body.id, merchantId, type: 'DEPOSIT' as const }
      : { referenceCode: body.referenceCode!, merchantId, type: 'DEPOSIT' as const };

    const pr = await prisma.paymentRequest.findFirst({ where });
    if (!pr) return res.status(404).json({ ok: false, error: 'Not found' });

    const pp = await prisma.providerPayment.findUnique({ where: { paymentRequestId: pr.id } });

    if (!pp) {
      return res.json({ ok: true, id: pr.id, referenceCode: pr.referenceCode, status: pr.status });
    }

    const methodCode = getMethodFromDetails(pr.detailsJson);
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
    if (['paid','completed','success','succeeded'].includes(normalized)) {
      newStatus = 'APPROVED';
    } else if (['failed','cancelled','canceled','rejected','expired'].includes(normalized)) {
      newStatus = 'REJECTED';
    } else {
      newStatus = null;
    }

    await prisma.providerPayment.update({
      where: { paymentRequestId: pr.id },
      data: { status: providerStatus, rawLatestJson: toJsonSafe(raw ?? {}) },
    });

    if (newStatus && newStatus !== pr.status) {
      await prisma.paymentRequest.update({ where: { id: pr.id }, data: { status: newStatus } });
    }

    return res.json({
      ok: true,
      id: pr.id,
      referenceCode: pr.referenceCode,
      status: newStatus || pr.status,
      provider: { status: providerStatus, ...(isDebug ? { raw: toJsonSafe(raw ?? {}) } : {}) },
    });
  }
);

merchantApiRouter.post(
  '/deposit/:id/receipt',
  eitherMerchantAuth,
  applyMerchantLimits,
  requireApiScopes([API_KEY_SCOPES.P2P]),
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

/* ────────────────────────────────────────────────────────────────────────────
   WITHDRAWALS (validate + create + status + balance)
──────────────────────────────────────────────────────────────────────────── */

// DYNAMIC banks in REAL mode, static fallback otherwise
merchantApiRouter.get(
  '/withdraw/config',
  apiKeyOnly,
  requireApiScopes([API_KEY_SCOPES.IDRV4_DISBURSE]),
  async (_req, res) => {
    const STATIC_BANKS = [
      { code: 'BCA', name: 'Bank Central Asia' },
      { code: 'BNI', name: 'Bank Negara Indonesia' },
      { code: 'BRI', name: 'Bank Rakyat Indonesia' },
      { code: 'MANDIRI', name: 'Bank Mandiri' },
    ];

    const mode = (process.env.FAZZ_MODE || 'SIM').toUpperCase();
    if (mode !== 'REAL') return res.json({ ok: true, banks: STATIC_BANKS, source: 'static' });

    try {
      const base = (process.env.FAZZ_API_BASE || '').replace(/\/+$/, '');
      const key = process.env.FAZZ_API_KEY || '';
      const secret = process.env.FAZZ_API_SECRET || '';
      if (!base || !key || !secret) {
        return res.json({ ok: true, banks: STATIC_BANKS, source: 'static' });
      }

      const auth = Buffer.from(`${key}:${secret}`).toString('base64');
      const r = await fetch(`${base}/banks`, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/vnd.api+json',
        },
      });

      const j: any = await r.json().catch(() => ({} as any));
      if (r.ok && Array.isArray(j?.data)) {
        const banks = j.data
          .map((b: any) => {
            const a = b?.attributes || {};
            return {
              code: a.shortCode || a.bankShortCode || b?.id || a.code || '',
              name: a.name || a.bankName || a.label || a.shortName || a.fullName || 'Unknown',
            };
          })
          .filter((x: any) => x.code);
        return res.json({ ok: true, banks, source: 'fazz' });
      }
    } catch {
      // fall through
    }
    return res.json({ ok: true, banks: STATIC_BANKS, source: 'static' });
  }
);

// NEW: Balance (provider overview)
merchantApiRouter.get(
  '/withdraw/balance',
  apiKeyOnly,
  requireApiScopes([API_KEY_SCOPES.IDRV4_DISBURSE]),
  async (_req, res) => {
    try {
      const b = await fazzGetBalance();
      return res.json({
        ok: true,
        balance: { total: b.total, available: b.available, pending: b.pending },
      });
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: e?.message || 'Unable to fetch balance' });
    }
  }
);

// Validate bank account holder (SIM ok; REAL via adapter when mode=REAL)
merchantApiRouter.post(
  '/withdraw/validate',
  apiKeyOnly,
  requireApiScopes([API_KEY_SCOPES.IDRV4_DISBURSE]),
  async (req, res) => {
    const schema = z.object({
      bankCode: z.string(),
      accountNo: z.string(),
      name: z.string().optional(),
    });
    const body = schema.parse(req.body);

    const providerRes =
      resolveProviderByMethodCode('VIRTUAL_BANK_ACCOUNT_STATIC') ||
      resolveProviderByMethodCode('VIRTUAL_BANK_ACCOUNT_DYNAMIC') ||
      { adapterName: 'fazz' as const };

    const adapter = adapters[providerRes.adapterName];
    const out = await adapter.validateBankAccount({ bankCode: body.bankCode, accountNo: body.accountNo, name: body.name });
    const holder = out.holder || "";

    let matchScore = 0;
    if (body.name && holder) {
      const a = body.name.toLowerCase().replace(/\s+/g, ' ').trim();
      const b = holder.toLowerCase().replace(/\s+/g, ' ').trim();
      if (a && b) {
        const common = a.split(' ').filter(x => b.includes(x));
        matchScore = Math.min(100, Math.round((common.join(' ').length / Math.max(a.length, 1)) * 100));
      }
    }

    res.json({ ok: true, valid: !!out.ok, holder, matchScore, raw: out.raw });
  }
);

// Create withdrawal request → CALL PROVIDER + persist ProviderDisbursement (NOW IDEMPOTENT)
merchantApiRouter.post(
  '/withdrawals',
  eitherMerchantAuth,
  applyMerchantLimits,
  requireApiScopes([API_KEY_SCOPES.IDRV4_DISBURSE]),
  async (req, res) => {
    const schema = z.object({
      user: z.object({ diditSubject: z.string() }),
      amountCents: z.number().int().positive(),
      currency: z.string().min(3).max(4),
      methodCode: z.string().optional(), // e.g., "FAZZ_SEND"
      destination: z.object({
        bankCode: z.string().optional(),
        bankName: z.string().optional(),
        holderName: z.string(),
        accountNo: z.string(),
        iban: z.string().optional(),
      }),
    });
    const body = schema.parse(req.body);
    const merchantId = (req as any).merchantId as string;

    const idemKey =
      req.header('Idempotency-Key') ||
      req.header('x-idempotency-key') ||
      undefined;

    // compute scope so the same withdrawal won’t be created twice
    const bankCode = (body.destination.bankCode || body.destination.bankName || "").toUpperCase();
    const scope = `withdraw:${[
      merchantId,
      body.user.diditSubject,
      body.currency.toUpperCase(),
      String(body.amountCents),
      bankCode,
      body.destination.accountNo,
    ].join(':')}`;

    const result = await withIdempotency(scope, idemKey, async () => {
      const user = await prisma.user.findUnique({ where: { diditSubject: body.user.diditSubject } });
      if (!user || !user.verifiedAt) return res.forbidden('User not verified');

      const mapping = await upsertMerchantClientMapping({ merchantId, userId: user.id });
      const clientStatus = normalizeClientStatus(mapping?.status);
      if (clientStatus !== 'ACTIVE') return rejectForClientStatus(res, clientStatus);

      const allowedMethods = await listMerchantMethods(merchantId);
      if (!allowedMethods.length) return res.forbidden('No methods assigned');

      const blocked = await prisma.payerBlocklist.findFirst({
        where: { merchantId, userId: user.id, active: true },
        select: { id: true },
      });
      if (blocked) return res.forbidden('User is blocked');

      const hasDeposit = await prisma.paymentRequest.findFirst({
        where: { userId: user.id, merchantId, type: 'DEPOSIT', status: 'APPROVED' },
      });
      if (!hasDeposit) return res.forbidden('Withdrawal blocked: no prior deposit');

      if (!bankCode) return res.badRequest('bankCode required');

      // Choose any enabled method (keep your pattern)
      const selectedMethod = allowedMethods[0] || null;
      if (!selectedMethod) return res.forbidden('No methods assigned');

      const referenceCode = generateTransactionId();
      const uniqueReference = generateUniqueReference();

      // Call provider adapter (create disbursement)
      const providerRes = resolveProviderByMethodCode(body.methodCode || 'FAZZ_SEND') || { adapterName: 'fazz' as const };
      const adapter = adapters[providerRes.adapterName];
      let providerPayoutId = "";
      let rawCreate: any = null;
      let providerStatus = "processing";

      try {
        const out = await adapter.createDisbursement({
          tid: referenceCode,
          merchantId,
          uid: user.publicId || user.id,
          amountCents: body.amountCents,
          currency: body.currency,
          bankCode,
          accountNo: body.destination.accountNo,
          holderName: body.destination.holderName,
        });
        providerPayoutId = out.providerPayoutId;
        providerStatus = String(out.status || "processing");
        rawCreate = toJsonSafe(out.raw ?? out);
      } catch (e: any) {
        console.error("[WITHDRAW_CREATE_FAIL]", e?.message || e);
        const msg = String(e?.message || 'Create disbursement failed');
        res.status(400).json({ ok: false, error: msg });
        return null;
      }

      const platformStatus = mapFazzDisbursementStatusToPlatform(providerStatus);

      // Persist ProviderDisbursement row + PaymentRequest atomically
      try {
        const txResult = await prisma.$transaction(async (tx) => {
          const created = await tx.paymentRequest.create({
            data: {
              type: 'WITHDRAWAL',
              status: platformStatus,
              amountCents: body.amountCents,
              currency: body.currency,
              referenceCode,
              uniqueReference,
              merchantId,
              userId: user.id,
              methodId: selectedMethod.id,
              detailsJson: {
                method: body.methodCode || 'FAZZ_SEND',
                destination: {
                  bankCode,
                  holderName: body.destination.holderName,
                  accountNo: body.destination.accountNo,
                },
              },
            },
            select: { id: true, referenceCode: true },
          });

          await tx.providerDisbursement.upsert({
            where: { providerPayoutId },
            update: {
              paymentRequestId: created.id,
              provider: "FAZZ",
              bankCode,
              accountNumber: body.destination.accountNo,
              accountHolder: body.destination.holderName,
              status: providerStatus,
              amountCents: body.amountCents,
              currency: body.currency,
              rawCreateJson: rawCreate,
            },
            create: {
              paymentRequestId: created.id,
              provider: "FAZZ",
              providerPayoutId,
              bankCode,
              accountNumber: body.destination.accountNo,
              accountHolder: body.destination.holderName,
              status: providerStatus,
              amountCents: body.amountCents,
              currency: body.currency,
              rawCreateJson: rawCreate,
            },
          });

          return { pr: created };
        });

        await tgNotify(
          `🟡 New WITHDRAWAL request\nRef: <b>${referenceCode}</b>\nAmount: ${body.amountCents} ${body.currency}\nBank: ${bankCode}`
        );

        return { id: txResult.pr.id, referenceCode, providerPayoutId };
      } catch (e) {
        console.error("[WITHDRAW_PERSIST_FAIL]", e);
        res.status(400).json({ ok: false, error: "Unable to create withdrawal" });
        return null;
      }
    });

    if (!result || (result as any).ok === false) return; // early Response from inside callback
    return res.ok(result);
  }
);

// confirm/poll a disbursement status (id or referenceCode)
merchantApiRouter.post(
  '/withdraw/confirm',
  apiKeyOnly,
  requireApiScopes([API_KEY_SCOPES.IDRV4_DISBURSE]),
  async (req, res) => {
    const schema = z.object({
      id: z.string().optional(),
      referenceCode: z.string().optional(),
    }).refine(v => v.id || v.referenceCode, { message: 'id or referenceCode is required' });
    const body = schema.parse(req.body);
    const merchantId = (req as any).merchantId as string;

    const where = body.id
      ? { id: body.id, merchantId, type: 'WITHDRAWAL' as const }
      : { referenceCode: body.referenceCode!, merchantId, type: 'WITHDRAWAL' as const };

    const pr = await prisma.paymentRequest.findFirst({ where });
    if (!pr) return res.status(404).json({ ok: false, error: 'Not found' });

    const pd = await prisma.providerDisbursement.findFirst({ where: { paymentRequestId: pr.id } });
    if (!pd) return res.json({ ok: true, id: pr.id, referenceCode: pr.referenceCode, status: pr.status });

    // flags
    const skipPoll =
      String(req.query?.skipPoll || '') === '1' ||
      process.env.WITHDRAW_CONFIRM_SKIP_POLL === '1';
    const forceSync =
      String(req.query?.forceSync || '') === '1' ||
      process.env.SYNC_PAYOUT_TO_PROVIDER === '1';
    const allowDowngrade = process.env.ALLOW_PAYOUT_DOWNGRADE === '1';

    // Helper to apply a candidate status with downgrade rules
    const maybeApply = async (candidate: LocalStatus | null) => {
      if (!candidate || candidate === pr.status) return;
      if (forceSync) {
        await prisma.paymentRequest.update({ where: { id: pr.id }, data: { status: candidate } });
        return;
      }
      // No force: avoid downgrades unless explicitly allowed
      const isDowngrade =
        (pr.status === 'APPROVED' && candidate !== 'APPROVED') ||
        (pr.status === 'REJECTED' && candidate !== 'REJECTED');
      if (isDowngrade && !allowDowngrade) return;
      await prisma.paymentRequest.update({ where: { id: pr.id }, data: { status: candidate } });
    };

    if (skipPoll) {
      // Use last known providerDisbursement.status (normalized) and sync locally if configured
      const providerNorm = normalizeProviderStatus(pd.status);
      const candidate = mapProviderToLocal(providerNorm);
      await maybeApply(candidate);
      return res.json({
        ok: true,
        id: pr.id,
        referenceCode: pr.referenceCode,
        status: (candidate ?? pr.status) || pr.status,
        provider: { status: providerNorm },
      });
    }

    // Poll provider (REAL behavior)
    const adapter = adapters.fazz; // only Fazz for now
    const { status, raw } = await adapter.getDisbursementStatus(pd.providerPayoutId);

    const providerNorm = normalizeProviderStatus(status);
    const providerStatusRaw = String(status || "");
    // Store raw provider status for IDR v4
    await prisma.providerDisbursement.update({
      where: { id: pd.id },
      data: { status: providerStatusRaw, rawLatestJson: toJsonSafe(raw ?? {}) },
    });

    // Decide local candidate; with forceSync we also allow PENDING from "processing"
    const candidate: LocalStatus | null =
      providerNorm === 'completed' ? 'APPROVED'
      : providerNorm === 'failed' ? 'REJECTED'
      : (forceSync ? 'PENDING' : null);

    await maybeApply(candidate);

    return res.json({
      ok: true,
      id: pr.id,
      referenceCode: pr.referenceCode,
      status: candidate || pr.status,
      provider: { status: providerNorm, raw: toJsonSafe(raw ?? {}) },
    });
  }
);

// alias to match your test habit: /api/v1/withdraw/confirm
merchantApiRouter.post(
  '/v1/withdraw/confirm',
  apiKeyOnly,
  requireApiScopes([API_KEY_SCOPES.IDRV4_DISBURSE]),
  async (req, res) => {
    (req.url as any) = '/withdraw/confirm';
    return (merchantApiRouter as any).handle(req, res);
  }
);

// OPTIONAL alias for balance under /v1 as well
merchantApiRouter.get(
  '/v1/withdraw/balance',
  apiKeyOnly,
  requireApiScopes([API_KEY_SCOPES.IDRV4_DISBURSE]),
  async (req, res) => {
    (req.url as any) = '/withdraw/balance';
    return (merchantApiRouter as any).handle(req, res);
  }
);

// read status by id
merchantApiRouter.get(
  '/withdraw/:id/status',
  apiKeyOnly,
  requireApiScopes([API_KEY_SCOPES.IDRV4_DISBURSE]),
  async (req, res) => {
    const pr = await prisma.paymentRequest.findUnique({ where: { id: req.params.id } });
    if (!pr || pr.merchantId !== req.merchantId || pr.type !== 'WITHDRAWAL') {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    const pd = await prisma.providerDisbursement.findFirst({ where: { paymentRequestId: pr.id } });
    if (!pd) return res.json({ ok: true, status: pr.status, provider: null });

    const { status, raw } = await adapters.fazz.getDisbursementStatus(pd.providerPayoutId);
    const providerNorm = normalizeProviderStatus(status);
    return res.json({ ok: true, status: pr.status, provider: { status: providerNorm, raw: toJsonSafe(raw) } });
  }
);

/* ────────────────────────────────────────────────────────────────────────────
   LISTING (unchanged)
──────────────────────────────────────────────────────────────────────────── */
merchantApiRouter.get(
  '/v1/payments',
  apiKeyOnly,
  applyMerchantLimits,
  requireApiScopes([API_KEY_SCOPES.P2P]),
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

merchantApiRouter.get(
  '/payments',
  apiKeyOnly,
  applyMerchantLimits,
  requireApiScopes([API_KEY_SCOPES.P2P]),
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

export default merchantApiRouter;