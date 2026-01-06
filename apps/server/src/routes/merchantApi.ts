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
import { ensureMerchantMethod, listMerchantMethods } from '../services/methods.js';

const uploadDir = path.join(process.cwd(), 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 10 * 1024 * 1024 } });

export const merchantApiRouter = Router();

function rejectForClientStatus(res: any, status: ClientStatus) {
  const message = status === 'BLOCKED' ? 'User is blocked' : 'User is deactivated';
  return res.forbidden ? res.forbidden(message) : res.status(403).json({ ok: false, error: message });
}

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

// Create a deposit intent and show bank details OR Fazz VA instructions
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
      // NEW (optional): pick a specific method & bank for VA
      methodCode: z.string().optional(),
      bankCode: z.string().optional(),
    });
    const body = schema.parse(req.body);
    const merchantId = (req as any).merchantId as string;
    const scope = `deposit:${merchantId}:${body.user.diditSubject}`;
    const idemKey = req.header('Idempotency-Key') ?? undefined;

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

        const allowedMethods = await listMerchantMethods(merchantId);
        const allowedCodes = allowedMethods.map((m) => m.code.trim().toUpperCase());
        if (!allowedCodes.length) throw new Error('NO_METHOD');

        // Blocklist check (merchant + user)
        const blocked = await prisma.payerBlocklist.findFirst({
          where: { merchantId, userId: user.id, active: true },
          select: { id: true },
        });
        if (blocked) throw new Error('User is blocked');

        // ---------- NEW: branch for Fazz VA (Static/Dynamic) ----------
        const requestedMethod = (body.methodCode || '').trim().toUpperCase();
        const isFazzVA =
          requestedMethod === 'VIRTUAL_BANK_ACCOUNT_STATIC' ||
          requestedMethod === 'VIRTUAL_BANK_ACCOUNT_DYNAMIC';

        if (isFazzVA) {
          // verify method is enabled by Super Admin
          if (!allowedCodes.includes(requestedMethod)) throw new Error('METHOD_NOT_ALLOWED');

          // create local PaymentRequest first
          const referenceCode = generateTransactionId(); // keep as your TID
          const uniqueReference = generateUniqueReference();

          // find the Method record (ensureMerchantMethod returns Method or null)
          const methodRecord = await ensureMerchantMethod(merchantId, requestedMethod);
          if (!methodRecord) throw new Error('METHOD_NOT_ALLOWED');

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
              methodId: methodRecord.id,
              detailsJson: { method: requestedMethod, bankCode: body.bankCode || null },
            },
          });

          // call provider adapter
          const { resolveProviderByMethodCode } = await import('../services/methods.js');
          const { providers } = await import('../services/providers/index.js');
          const mappingProv = resolveProviderByMethodCode(requestedMethod);
          if (!mappingProv) throw new Error('METHOD_NOT_ALLOWED');

          const adapter = providers[mappingProv.provider as 'FAZZ'];
          const diditName = user.fullName || '';
          if (!body.bankCode) throw new Error('BANK_CODE_REQUIRED');

          // NOTE: If Fazz expects amounts in IDR (not cents), divide here.
          // const amountForFazz = Math.floor(body.amountCents / 100);

          const intent = await adapter.createDepositIntent({
            tid: referenceCode,
            uid: String(user.id),
            merchantId,
            methodCode: requestedMethod,
            amountCents: body.amountCents, // see note above
            currency: body.currency,
            bankCode: body.bankCode,
            kyc: { fullName: diditName, diditSubject: user.diditSubject! },
          });

          await prisma.providerPayment.create({
            data: {
              paymentRequestId: pr.id,
              provider: 'FAZZ',
              providerPaymentId: intent.providerPaymentId,
              methodType: 'virtual_bank_account',
              bankCode: body.bankCode,
              accountNumber: intent.va.accountNo,
              accountName: intent.va.accountName,
              expiresAt: intent.expiresAt ? new Date(intent.expiresAt) : null,
              status: 'pending',
              instructionsJson: intent.instructions || {},
              rawCreateJson: intent as any,
            },
          });

          await tgNotify(
            `🟢 New DEPOSIT (Fazz VA)\nRef: <b>${referenceCode}</b>\nAmount: ${body.amountCents} ${body.currency}\nMethod: ${requestedMethod}`
          );

          return {
            id: pr.id,
            referenceCode,
            instructions: {
              va: intent.va,
              expiresAt: intent.expiresAt || null,
              text: [
                'Transfer must come from your own account.',
                `Name must match your KYC: ${diditName}`,
                'Payments from another sender may be rejected/blocked.',
              ],
            },
          };
        }
        // ---------- END Fazz VA branch ----------

        // ---------- Existing P2P flow (unchanged) ----------
        const bank = await prisma.bankAccount.findFirst({
          where: {
            active: true,
            currency: body.currency,
            OR: [{ merchantId }, { merchantId: null }],
            method: { in: allowedCodes },
          },
          orderBy: [
            { merchantId: 'desc' },
            { createdAt: 'desc' },
          ],
        });
        if (!bank) throw new Error('No active bank account for currency');

        const methodRecord = await ensureMerchantMethod(merchantId, bank.method || '');
        if (!methodRecord) throw new Error('METHOD_NOT_ALLOWED');

        const referenceCode = generateTransactionId();
        const uniqueReference = generateUniqueReference();
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
            detailsJson: { method: bank.method },
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
        // ---------- END existing P2P flow ----------
      });

      res.ok(result);
    } catch (err: any) {
      const message = err?.message || '';
      if (message === 'BANK_CODE_REQUIRED') return res.status(400).json({ ok: false, error: 'Missing bankCode' });
      if (message === 'NO_METHOD') return res.status(400).json({ ok: false, error: 'No methods assigned' });
      if (message === 'METHOD_NOT_ALLOWED') return res.status(400).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
      if (message === 'CLIENT_INACTIVE') return res.forbidden('Client is blocked or deactivated');
      if (message === 'User is blocked') return res.forbidden('User is blocked');
      return res.status(400).json({ ok: false, error: 'Unable to create deposit intent' });
    }
  }
);

// Confirm deposit (poll provider and map status)
merchantApiRouter.post(
  '/deposit/confirm',
  eitherMerchantAuth,
  applyMerchantLimits,
  requireApiScopes(['read:deposit']),
  async (req, res) => {
    const schema = z.object({ tid: z.string().min(1) });
    const { tid } = schema.parse(req.body);

    // find PR by referenceCode (we used referenceCode as TID above)
    const pr = await prisma.paymentRequest.findFirst({
      where: { referenceCode: tid, type: 'DEPOSIT' },
      include: { method: true },
    });
    if (!pr) return res.notFound ? res.notFound() : res.status(404).json({ ok: false, error: 'Unknown TID' });

    // see if it's a Fazz provider flow
    const pp = await prisma.providerPayment.findUnique({ where: { paymentRequestId: pr.id } });
    if (!pp) {
      // P2P path → nothing to poll here, return current status
      return res.ok({ ok: true, tid, status: pr.status });
    }

    const { providers } = await import('../services/providers/index.js');
    const adapter = providers[(pp.provider as 'FAZZ')];
    const status = await adapter.getDepositStatus(pp.providerPaymentId);

    let newStatus = pr.status;
    if (status.status === 'paid') newStatus = 'APPROVED';
    if (status.status === 'completed') newStatus = 'APPROVED';
    if (['expired', 'cancelled', 'failed'].includes(status.status)) newStatus = 'REJECTED';

    await prisma.paymentRequest.update({
      where: { id: pr.id },
      data: {
        status: newStatus,
        detailsJson: { ...(pr.detailsJson as any), providerStatus: status.status },
        updatedAt: new Date(),
      },
    });
    await prisma.providerPayment.update({
      where: { paymentRequestId: pr.id },
      data: { status: status.status, rawLatestJson: status.raw as any },
    });

    return res.ok({ ok: true, tid, status: newStatus });
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

// List banks for withdrawal (stub; can be wired to provider list)
merchantApiRouter.get(
  '/withdraw/config',
  eitherMerchantAuth,
  applyMerchantLimits,
  requireApiScopes(['read:withdrawal']),
  async (_req, res) => {
    // TODO: call adapter to fetch live list; for now return empty array (UI-safe)
    return res.ok({ banks: [], kycRequired: true });
  }
);

merchantApiRouter.post(
  '/withdraw/validate',
  eitherMerchantAuth,
  applyMerchantLimits,
  requireApiScopes(['write:withdrawal']),
  async (req, res) => {
    const schema = z.object({
      bankCode: z.string(),
      accountNo: z.string(),
      holderName: z.string().optional(),
    });
    const body = schema.parse(req.body);
    const { providers } = await import('../services/providers/index.js');
    const adapter = providers.FAZZ;
    const out = await adapter.validateBankAccount({ bankCode: body.bankCode, accountNo: body.accountNo });

    // reuse your existing name-match evaluator
    const { evaluateNameMatch } = await import('../services/paymentStatus.js');
    const score = out.holder ? evaluateNameMatch(body.holderName || '', out.holder) : 0;

    return res.ok({ ok: out.ok, holder: out.holder, matchScore: score });
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

    const mapping = await upsertMerchantClientMapping({ merchantId, userId: user.id });
    const clientStatus = normalizeClientStatus(mapping?.status);
    if (clientStatus !== 'ACTIVE') return res.forbidden('Client is blocked or deactivated');

    const allowedMethods = await listMerchantMethods(merchantId);
    const selectedMethod = allowedMethods[0] || null;
    if (!selectedMethod) return res.forbidden('No methods assigned');

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

    // ---------- NEW: call Fazz to create the disbursement ----------
    try {
      const { providers } = await import('../services/providers/index.js');
      const adapter = providers.FAZZ;

      // NOTE: If Fazz expects amounts in IDR (not cents), divide here.
      // const amountForFazz = Math.floor(body.amountCents / 100);

      const out = await adapter.createDisbursement({
        tid: referenceCode,
        merchantId,
        uid: String(user.id),
        amountCents: body.amountCents, // see note above
        currency: body.currency,
        bankCode: body.destination.bankName,  // assuming this holds the bank short code
        accountNo: body.destination.accountNo,
        holderName: body.destination.holderName,
      });

      await prisma.providerDisbursement.create({
        data: {
          paymentRequestId: pr.id,
          provider: 'FAZZ',
          providerPayoutId: out.providerPayoutId,
          bankCode: body.destination.bankName,
          accountNumber: body.destination.accountNo,
          accountHolder: body.destination.holderName,
          status: 'pending',
          amountCents: body.amountCents,
          currency: body.currency,
          rawCreateJson: out as any,
        },
      });

      await tgNotify(
        `🟡 WITHDRAWAL created (Fazz)\nRef: <b>${referenceCode}</b>\nAmount: ${body.amountCents} ${body.currency}`
      );
      return res.ok({ id: pr.id, referenceCode, uniqueReference, providerPayoutId: out.providerPayoutId });
    } catch (e) {
      // Keep PR and destination for traceability even if provider call fails
      return res.status(400).json({ ok: false, error: 'Unable to create disbursement' });
    }
    // ---------- END NEW ----------
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
