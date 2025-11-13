// apps/server/src/routes/merchantPortal.ts
import { Router, Request } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import { stringify } from "csv-stringify";
import ExcelJS from "exceljs";
import crypto from "node:crypto";
import { seal } from "../services/secretBox.js";
import jwt from "jsonwebtoken";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { getUserDirectory, getAllUsers, renderUserDirectoryPdf } from "../services/userDirectory.js";
import {
  buildPaymentExportFile,
  normalizeColumns,
  PaymentExportColumn,
  PaymentExportItem,
} from "../services/paymentExports.js";
import * as refs from "../services/reference.js";
import { listAccountEntries } from "../services/merchantAccounts.js";
import { signCheckoutToken } from "../services/checkoutToken.js";
import { normalizeTimezone, resolveTimezone } from "../lib/timezone.js";
import { getApiKeyRevealConfig } from "../config/apiKeyReveal.js";
import { revealApiKey, ApiKeyRevealError } from "../services/apiKeyReveal.js";
import { ipFromReq, uaFromReq } from "../services/audit.js";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

const userQuery = z.object({
  q: z.string().optional(),
  page: z.string().optional(),
  perPage: z.string().optional(),
});

function usersFeatureEnabled(res: any): boolean {
  return !!res?.locals?.merchantFeatures?.usersEnabled;
}

async function collectMerchantUsersForExport(merchantId: string, search?: string | null) {
  return getAllUsers({ merchantIds: [merchantId], search: search ?? null });
}

function currentMerchantUserId(req: any): string | null {
  if (req.merchantUser?.id) return String(req.merchantUser.id);
  const auth = req.merchantAuth || {};
  if (typeof auth.merchantUserId === "string" && auth.merchantUserId) {
    return auth.merchantUserId;
  }
  if (typeof auth.sub === "string" && auth.sub) {
    const merchantId = req.merchant?.sub ? String(req.merchant.sub) : null;
    if (!merchantId || auth.sub !== merchantId) return auth.sub;
  }
  return null;
}

function normalizeTestSubject(input: any, merchantId: string): string {
  const raw = typeof input === "string" ? input.trim() : "";
  if (raw && /^[A-Za-z0-9_.-]{3,64}$/.test(raw)) return raw;
  const tail = merchantId.replace(/[^A-Za-z0-9]/g, "").slice(-6) || merchantId.slice(-6) || "demo";
  const ts = Date.now().toString(36);
  const generated = `merchant-${tail}-${ts}`;
  return generated.slice(0, 64);
}

type RenderKeysOptions = {
  error?: string | null;
  justCreated?: string | null;
};

async function renderMerchantApiKeys(req: any, res: any, options: RenderKeysOptions = {}) {
  const merchantId = req.merchant?.sub as string;
  if (!merchantId) return res.redirect("/public/merchant/login");

  const keys = await listMerchantApiKeys(merchantId);

  const merchantUser = req.merchantUser || null;
  const config = getApiKeyRevealConfig();
  const allowSelfService = req.merchantDetails?.apiKeysSelfServiceEnabled !== false;
  const policyEnabled = config.allow;
  const permissionGranted = !!merchantUser?.canRevealApiKeys;
  const revealAllowed = permissionGranted && policyEnabled;
  const requireTotp = !!merchantUser?.twoFactorEnabled;

  const revealMap: Record<string, string> = {};
  if (revealAllowed && merchantUser?.id && keys.length) {
    const logs = await prisma.merchantApiKeyRevealLog.findMany({
      where: {
        merchantApiKeyId: { in: keys.map((k) => k.id) },
        merchantUserId: merchantUser.id,
        outcome: "SUCCESS",
      },
      orderBy: { createdAt: "desc" },
    });
    for (const log of logs) {
      if (!log.merchantApiKeyId) continue;
      if (!revealMap[log.merchantApiKeyId]) {
        revealMap[log.merchantApiKeyId] = log.createdAt.toISOString();
      }
    }
  }

  res.render("merchant/api-keys", {
    title: "API Keys",
    keys,
    justCreated: options.justCreated ?? null,
    error: options.error ?? null,
    selfService: allowSelfService,
    revealAllowed,
    revealPolicyEnabled: policyEnabled,
    revealPermissionGranted: permissionGranted,
    revealConfig: config,
    revealState: {
      requireTotp,
      requirePassword: !requireTotp,
      stepStorage: "merchant.keyReveal.step",
      lastRevealed: revealMap,
    },
  });
}

async function loadCurrentMerchantUser(req: any) {
  const id = currentMerchantUserId(req);
  if (!id) return null;
  return prisma.merchantUser.findUnique({
    where: { id },
    select: {
      id: true,
      merchantId: true,
      email: true,
      twoFactorEnabled: true,
      totpSecret: true,
      timezone: true,
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Merchant auth guard — tolerant to old/new token shapes
// ─────────────────────────────────────────────────────────────
async function requireMerchant(req: any, res: any, next: any) {
  const tok =
    req.cookies?.merchant_jwt ||
    req.cookies?.merchant ||
    null;

  if (!tok) return res.redirect("/public/merchant/login");

  try {
    const p: any = jwt.verify(tok, JWT_SECRET);

    // New tokens carry merchantId; try these first
    let merchantId: string | null =
      p.merchantId || p.mid || p.merchant || null;

    // Back-compat: older tokens had only sub = merchantUserId
    if (!merchantId && p.sub) {
      const mu = await prisma.merchantUser.findUnique({
        where: { id: String(p.sub) },
        select: { merchantId: true },
      });
      merchantId = mu?.merchantId || null;
    }

    if (!merchantId) {
      // Stale/malformed cookie → clear + bounce to login
      res.clearCookie("merchant_jwt", { path: "/" });
      res.clearCookie("merchant",     { path: "/" });
      return res.redirect("/public/merchant/login");
    }

    // Maintain compatibility with existing code:
    // many routes read req.merchant?.sub as merchantId
    req.merchant = { sub: merchantId };
    req.merchantAuth = p; // expose full payload if needed
    return next();
  } catch {
    res.clearCookie("merchant_jwt", { path: "/" });
    res.clearCookie("merchant",     { path: "/" });
    return res.redirect("/public/merchant/login");
  }
}

// All routes below require merchant auth
router.use(requireMerchant);

router.use(async (req: any, res, next) => {
  const merchantId = req.merchant?.sub as string | undefined;
  if (!merchantId) return next();
  if (!req.merchantDetails) {
    req.merchantDetails = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: {
        id: true,
        name: true,
        email: true,
        balanceCents: true,
        defaultCurrency: true,
        userDirectoryEnabled: true,
        apiKeysSelfServiceEnabled: true,
        active: true,
        status: true,
      },
    });
  }
  const merchantDetails = req.merchantDetails;
  const status = String(merchantDetails?.status || "").toLowerCase();
  if (!merchantDetails?.active || status === "suspended" || status === "closed") {
    try {
      res.clearCookie("merchant_jwt", { path: "/" });
      res.clearCookie("merchant", { path: "/" });
    } catch {}
    return res.redirect("/public/merchant/login?reason=merchant-inactive");
  }
  const authPayload = req.merchantAuth || {};
  const tokenSub = typeof authPayload?.sub === "string" ? authPayload.sub : null;
  const merchantUserId = typeof authPayload?.merchantUserId === "string"
    ? authPayload.merchantUserId
    : tokenSub && tokenSub !== merchantId
      ? tokenSub
      : null;

  if (!req.merchantUser && merchantUserId) {
    req.merchantUser = await prisma.merchantUser.findUnique({
      where: { id: merchantUserId },
      select: {
        id: true,
        email: true,
        role: true,
        canViewUserDirectory: true,
        canRevealApiKeys: true,
        twoFactorEnabled: true,
      },
    });
  }

  const merchantUser = req.merchantUser || null;
  const merchantEnabled = !!req.merchantDetails?.userDirectoryEnabled;
  const tokenFlag = typeof authPayload?.canViewUsers === "boolean" ? authPayload.canViewUsers : null;
  const userAllowed = merchantUser ? merchantUser.canViewUserDirectory !== false : true;
  const canViewUsers = merchantEnabled && (tokenFlag !== null ? tokenFlag : userAllowed);

  req.merchantCanViewUsers = canViewUsers;
  if (authPayload && typeof authPayload === "object") {
    authPayload.canViewUsers = canViewUsers;
    if (merchantUserId) authPayload.merchantUserId = merchantUserId;
  }
  res.locals.merchant = merchantDetails;
  res.locals.merchantUser = merchantUser;
  res.locals.merchantAuth = authPayload;
  res.locals.merchantFeatures = { usersEnabled: canViewUsers };
  res.locals.merchantCanRevealKeys = !!req.merchantUser?.canRevealApiKeys;
  res.locals.merchantRequiresTotp = !!req.merchantUser?.twoFactorEnabled;
  const timezoneSource = merchantUser?.timezone ?? (authPayload && typeof authPayload === "object" ? (authPayload as any).timezone : null);
  const timezone = resolveTimezone(timezoneSource);
  res.locals.timezone = timezone;
  (req as any).activeTimezone = timezone;
  next();
});

// ─────────────────────────────────────────────────────────────
// Merchant security settings (2FA)
// ─────────────────────────────────────────────────────────────
router.get('/settings/security', async (req: any, res) => {
  const user = await loadCurrentMerchantUser(req);
  if (!user) return res.redirect('/auth/merchant/login');

  const enabled = !!(user.twoFactorEnabled && user.totpSecret);
  const { enabled: justEnabled, disabled: justDisabled, already, error } = req.query || {};
  let flash: { message: string; variant?: 'error' } | null = null;
  if (typeof error === 'string' && error) {
    flash = { message: error, variant: 'error' };
  } else if (typeof already !== 'undefined') {
    flash = { message: 'Two-factor authentication is already enabled.' };
  } else if (typeof justEnabled !== 'undefined') {
    flash = { message: 'Two-factor authentication enabled.' };
  } else if (typeof justDisabled !== 'undefined') {
    flash = { message: 'Two-factor authentication disabled.' };
  }

  return res.render('merchant-settings-security', {
    title: 'Security',
    twoFactorEnabled: enabled,
    email: user.email || '',
    flash,
  });
});

router.post('/settings/security/start', async (req: any, res) => {
  const user = await loadCurrentMerchantUser(req);
  if (!user) return res.redirect('/auth/merchant/login');

  if (user.twoFactorEnabled && user.totpSecret) {
    return res.redirect('/merchant/settings/security?already=1');
  }

  try {
    const secret = speakeasy.generateSecret({ name: `Merchant (${user.email || user.id})` });
    const otpauth = secret.otpauth_url!;
    const qrDataUrl = await QRCode.toDataURL(otpauth);

    const token = jwt.sign({
      userId: user.id,
      merchantId: user.merchantId,
      stage: '2fa_setup',
      secretBase32: secret.base32,
      issuer: 'Merchant',
      accountLabel: user.email || user.id,
      redirectTo: '/merchant/settings/security?enabled=1',
    }, JWT_SECRET, { expiresIn: '10m' });

    return res.render('auth-2fa-setup', {
      token,
      qrDataUrl,
      secretBase32: secret.base32,
      accountLabel: user.email || user.id,
      error: '',
      mode: 'merchant',
    });
  } catch (err) {
    console.error('[merchant 2fa] start failed', err);
    const msg = encodeURIComponent('Unable to start two-factor setup.');
    return res.redirect(`/merchant/settings/security?error=${msg}`);
  }
});

router.post('/settings/security/disable', async (req: any, res) => {
  const user = await loadCurrentMerchantUser(req);
  if (!user) return res.redirect('/auth/merchant/login');

  try {
    await prisma.merchantUser.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, totpSecret: null },
    });
    return res.redirect('/merchant/settings/security?disabled=1');
  } catch (err) {
    console.error('[merchant 2fa] disable failed', err);
    const msg = encodeURIComponent('Unable to disable two-factor authentication.');
    return res.redirect(`/merchant/settings/security?error=${msg}`);
  }
});

const listQuery = z.object({
  q: z.string().optional(),
  id: z.string().optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
  amountMin: z.string().optional(),
  amountMax: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  dateField: z.enum(["createdAt", "processedAt", "updatedAt"]).optional(),
  sort: z.string().optional(),
  page: z.string().optional(),
  perPage: z.string().optional(),
  type: z.enum(["DEPOSIT", "WITHDRAWAL"]).optional(),
});

const LIST_QUERY_KEYS = new Set(Object.keys((listQuery as any).shape || {}));

const MERCHANT_PAYMENT_EXPORT_COLUMNS: PaymentExportColumn[] = [
  { key: "txnId", label: "TRANSACTION ID" },
  { key: "userId", label: "USER ID" },
  { key: "type", label: "TYPE" },
  { key: "currency", label: "CURRENCY" },
  { key: "amount", label: "AMOUNT" },
  { key: "status", label: "STATUS" },
  { key: "bank", label: "BANK" },
  { key: "created", label: "DATE OF CREATION" },
  { key: "processedAt", label: "DATE PROCESSED" },
  { key: "processingTime", label: "TIME TO PROCESS" },
  { key: "userInfo", label: "USER INFO" },
  { key: "comment", label: "COMMENT" },
  { key: "admin", label: "PROCESSED BY" },
];

function int(v: any, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function statusesCSV(s?: string) {
  if (!s) return undefined;
  const ok = new Set(["PENDING", "SUBMITTED", "APPROVED", "REJECTED"]);
  const arr = s.split(",").map(x => x.trim().toUpperCase()).filter(x => ok.has(x));
  return arr.length ? arr : undefined;
}
function sortSpec(s?: string) {
  const wl = new Set(["createdAt", "processedAt", "updatedAt", "amountCents", "status", "currency", "referenceCode"]);
  let col = "createdAt", dir: "asc" | "desc" = "desc";
  if (s) {
    const [c, d] = s.split(":");
    if (c && wl.has(c)) col = c;
    if (d === "asc" || "desc" === d) dir = d;
  }
  return { [col]: dir } as any;
}
function whereFrom(q: z.infer<typeof listQuery>, merchantId: string, type?: "DEPOSIT" | "WITHDRAWAL") {
  const where: any = { merchantId };
  if (type) where.type = type;
  if (q.id) where.id = q.id;
  if (q.currency) where.currency = q.currency;
  const sts = statusesCSV(q.status);
  if (sts) where.status = { in: sts };
  if (q.amountMin || q.amountMax) {
    where.amountCents = {};
    if (q.amountMin) {
      const v = Number(q.amountMin);
      if (Number.isFinite(v)) where.amountCents.gte = Math.round(v * 100);
    }
    if (q.amountMax) {
      const v = Number(q.amountMax);
      if (Number.isFinite(v)) where.amountCents.lte = Math.round(v * 100);
    }
  }
  const df = q.dateField === "processedAt" ? "processedAt" : (q.dateField === "updatedAt" ? "updatedAt" : "createdAt");
  if (q.from || q.to) {
    where[df] = {};
    if (q.from) where[df].gte = new Date(q.from);
    if (q.to) where[df].lte = new Date(q.to);
  }
  if (q.q) where.OR = [
    { referenceCode: { contains: q.q, mode: "insensitive" } },
    { uniqueReference: { contains: q.q, mode: "insensitive" } }
  ];
  return where;
}

type ListQuery = z.infer<typeof listQuery>;

async function fetchPaymentsFromQuery(
  input: Partial<ListQuery>,
  merchantId: string,
  type?: "DEPOSIT" | "WITHDRAWAL"
) {
  const q = listQuery.parse(input);
  const where = whereFrom(q, merchantId, type ?? q.type);
  const page = Math.max(1, int(q.page, 1));
  const perPage = Math.min(150, Math.max(5, int(q.perPage, 25)));
  const orderBy = sortSpec(q.sort);

  const [total, items] = await Promise.all([
    prisma.paymentRequest.count({ where }),
    prisma.paymentRequest.findMany({
      where,
      select: {
        id: true,
        type: true,
        status: true,
        amountCents: true,
        currency: true,
        referenceCode: true,
        uniqueReference: true,
        createdAt: true,
        updatedAt: true,
        processedAt: true,
        notes: true,
        rejectedReason: true,
        detailsJson: true,
        merchantId: true,
        bankAccountId: true,
        merchant: { select: { id: true, name: true } },
        user: { select: { id: true, publicId: true, email: true, phone: true } },
        processedByAdmin: { select: { id: true, email: true, displayName: true } },
        bankAccount: { select: { publicId: true, bankName: true, method: true } },
        receiptFile: { select: { path: true, original: true } },
      },
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return { total, items, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)), query: q };
}

async function fetchPayments(req: Request, merchantId: string, type?: "DEPOSIT" | "WITHDRAWAL") {
  const q = req.query as Partial<ListQuery>;
  return fetchPaymentsFromQuery(q, merchantId, type);
}

function parseExportFormat(raw: unknown): "csv" | "xlsx" | "pdf" {
  const value = String(raw || "").toLowerCase();
  if (value === "csv" || value === "xlsx" || value === "pdf") return value;
  return "csv";
}

function coerceExportFilters(raw: unknown): Partial<ListQuery> {
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<ListQuery> = {};
  for (const key of LIST_QUERY_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "undefined" || value === null) continue;
    if (typeof value === "string") {
      (out as any)[key] = value;
    } else if (Array.isArray(value)) {
      const last = value[value.length - 1];
      if (typeof last === "string") (out as any)[key] = last;
    } else {
      (out as any)[key] = String(value);
    }
  }
  return out;
}

function sanitizeColumns(raw: unknown, fallback: PaymentExportColumn[]): PaymentExportColumn[] {
  const allowed = new Set(fallback.map((col) => col.key));
  return normalizeColumns(raw, fallback, allowed);
}

const SUBJECT_MAX_LENGTH = 64;
const SUBJECT_SANITIZE = /[^A-Za-z0-9_.-]/g;
const DEFAULT_TEST_DEPOSIT_CENTS = 50_00; // $50.00
const DEFAULT_TEST_WITHDRAWAL_CENTS = 40_00; // $40.00
const MAX_TEST_AMOUNT_CENTS = 1_000_000_00; // $1,000,000.00 cap for safety
const TEST_PAYMENT_NOTES = {
  deposit: "Test deposit (merchant portal)",
  withdrawal: "Test withdrawal (merchant portal)",
} as const;
const TEST_PAYMENT_PAYER = {
  holderName: "Test User",
  bankName: "Test Bank",
  accountNo: "00000000",
  bsb: "000-000",
};

class TestPaymentError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "TestPaymentError";
    this.status = status;
  }
}

function sanitizeSubjectInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(SUBJECT_SANITIZE, "");
  const normalized = cleaned.slice(0, SUBJECT_MAX_LENGTH);
  return normalized || null;
}

function fallbackSubjectForMerchant(merchantId: string): string {
  const safeMerchant = (merchantId || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
  const random = crypto.randomBytes(4).toString("hex");
  const composed = `test_${safeMerchant || "merchant"}_${random}`;
  return composed.slice(0, SUBJECT_MAX_LENGTH);
}

async function ensureTestUser(merchantId: string, requestedSubject?: string | null) {
  const normalized = sanitizeSubjectInput(requestedSubject);
  const subject = normalized || fallbackSubjectForMerchant(merchantId);
  const now = new Date();

  const user = await prisma.user.upsert({
    where: { diditSubject: subject },
    create: {
      diditSubject: subject,
      publicId: refs.generateUserId(),
      verifiedAt: now,
    },
    update: { verifiedAt: now },
    select: { id: true, diditSubject: true },
  });

  return { userId: user.id, subject: user.diditSubject };
}

function parseAmountCents(raw: unknown, fallback: number): number {
  const clamp = (value: number) => {
    const positive = Math.max(1, Math.round(value));
    return Math.min(positive, MAX_TEST_AMOUNT_CENTS);
  };

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return clamp(raw);
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return fallback;
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return fallback;
    if (trimmed.includes(".")) return clamp(value * 100);
    return clamp(value);
  }

  return fallback;
}

function readRequestedSubject(req: Request | any): string | null {
  const body = req.body || {};
  if (typeof body.subject === "string" && body.subject.trim()) return body.subject;
  if (typeof body.diditSubject === "string" && body.diditSubject.trim()) return body.diditSubject;

  const query = (req.query || {}) as Record<string, unknown>;
  if (typeof query.subject === "string" && query.subject.trim()) return query.subject as string;
  if (typeof query.diditSubject === "string" && query.diditSubject.trim()) return query.diditSubject as string;
  return null;
}

async function resolveMerchantCurrency(req: any, merchantId: string): Promise<string> {
  const fromRequest = req.merchantDetails?.defaultCurrency;
  if (fromRequest) return fromRequest;

  const record = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { defaultCurrency: true },
  });

  return record?.defaultCurrency || "AUD";
}

async function findTestBankAccount(merchantId: string, currency: string) {
  return prisma.bankAccount.findFirst({
    where: {
      currency,
      active: true,
      OR: [{ merchantId }, { merchantId: null }],
    },
    orderBy: [
      { merchantId: "desc" },
      { createdAt: "desc" },
    ],
    select: { id: true, bankName: true, method: true },
  });
}

async function createTestDeposit(opts: {
  merchantId: string;
  userId: string;
  subject: string;
  amountCents: number;
  currency: string;
}) {
  const bankAccount = await findTestBankAccount(opts.merchantId, opts.currency);
  const referenceCode = refs.generateTransactionId()
  const uniqueReference = refs.generateUniqueReference();

  const details: Record<string, any> = {
    test: true,
    origin: "merchant-portal-test",
    subject: opts.subject,
    method: bankAccount?.method || "OSKO",
    payer: { ...TEST_PAYMENT_PAYER },
    extras: { testSubject: opts.subject },
  };

  return prisma.paymentRequest.create({
    data: {
      type: "DEPOSIT",
      status: "PENDING",
      amountCents: opts.amountCents,
      currency: opts.currency,
      referenceCode,
      uniqueReference,
      merchantId: opts.merchantId,
      userId: opts.userId,
      bankAccountId: bankAccount?.id ?? null,
      detailsJson: details,
      notes: TEST_PAYMENT_NOTES.deposit,
    },
  });
}

async function createTestWithdrawal(opts: {
  merchantId: string;
  userId: string;
  subject: string;
  amountCents: number;
  currency: string;
}) {
  const referenceCode = refs.generateTransactionId();
  const uniqueReference = refs.generateUniqueReference();

  return prisma.$transaction(async (tx) => {
    const destination = await tx.withdrawalDestination.create({
      data: {
        userId: opts.userId,
        currency: opts.currency,
        bankName: TEST_PAYMENT_PAYER.bankName,
        holderName: TEST_PAYMENT_PAYER.holderName,
        accountNo: TEST_PAYMENT_PAYER.accountNo,
        iban: null,
      },
      select: { id: true, bankName: true, holderName: true, accountNo: true },
    });

    const details: Record<string, any> = {
      test: true,
      origin: "merchant-portal-test",
      subject: opts.subject,
      method: "OSKO",
      destination: {
        bankName: destination.bankName,
        holderName: destination.holderName,
        accountNo: destination.accountNo,
        bsb: TEST_PAYMENT_PAYER.bsb,
      },
      extras: { testSubject: opts.subject },
      destinationId: destination.id,
    };

    return tx.paymentRequest.create({
      data: {
        type: "WITHDRAWAL",
        status: "PENDING",
        amountCents: opts.amountCents,
        currency: opts.currency,
        referenceCode,
        uniqueReference,
        merchantId: opts.merchantId,
        userId: opts.userId,
        detailsJson: details,
        notes: TEST_PAYMENT_NOTES.withdrawal,
      },
    });
  });
}

// Dashboard
router.get("/", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const awaitingStatuses: Array<'PENDING' | 'SUBMITTED'> = ['PENDING', 'SUBMITTED'];
  const [pendingDeposits, pendingWithdrawals, totalsToday, latest] = await Promise.all([
    prisma.paymentRequest.count({ where: { merchantId, type: "DEPOSIT", status: { in: awaitingStatuses } } }),
    prisma.paymentRequest.count({ where: { merchantId, type: "WITHDRAWAL", status: { in: awaitingStatuses } } }),
    prisma.paymentRequest.groupBy({
      by: ["type"],
      where: { merchantId, createdAt: { gte: today }, status: "APPROVED" },
      _sum: { amountCents: true },
    }),
    prisma.paymentRequest.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: 10,
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
    }),
  ]);

  const merchant = req.merchantDetails || await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { name: true, balanceCents: true, defaultCurrency: true },
  });

  res.render("merchant/dashboard", {
    title: "Merchant Dashboard",
    merchant,
    metrics: {
      pendingDeposits,
      pendingWithdrawals,
      todayDeposits: totalsToday.find(t => t.type === "DEPOSIT")?._sum.amountCents ?? 0,
      todayWithdrawals: totalsToday.find(t => t.type === "WITHDRAWAL")?._sum.amountCents ?? 0,
    },
    latest,
  });
});

// Payments list
router.get("/payments", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;

  const { total, items, page, perPage, pages, query } = await fetchPayments(req, merchantId);

  let title = "Payments";
  const t = (query.type || "").toString().toUpperCase();
  if (t === "DEPOSIT") title = "Deposits";
  else if (t === "WITHDRAWAL") title = "Withdrawals";

  res.render("merchant/payments", {
    title,
    table: { total, items, page, perPage, pages },
    query,
  });
});

router.get("/payments/deposits", (_req, res) => res.redirect("/merchant/payments?type=DEPOSIT"));
router.get("/payments/withdrawals", (_req, res) => res.redirect("/merchant/payments?type=WITHDRAWAL"));
router.get("/payments/test", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  if (!merchantId) return res.redirect("/merchant/payments");

  const subject = normalizeTestSubject(req.query?.subject, merchantId);
  const currency = (req.merchantDetails?.defaultCurrency || "AUD").toUpperCase();
  const token = signCheckoutToken({ merchantId, diditSubject: subject, currency });

  res.render("merchant/payments-test", {
    title: "Test Payments",
    testCheckout: { subject, token },
  });
});

router.post("/payments/test/session", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  if (!merchantId) return res.status(401).json({ ok: false, error: "Unauthorized" });
  const subject = normalizeTestSubject(req.body?.subject || req.query?.subject, merchantId);
  const currency = (req.merchantDetails?.defaultCurrency || "AUD").toUpperCase();
  const token = signCheckoutToken({ merchantId, diditSubject: subject, currency });
  res.json({ ok: true, token, subject, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() });
});

router.get("/users", async (req: any, res) => {
  if (!usersFeatureEnabled(res)) {
    return res.status(403).render("merchant/users-disabled", { title: "Clients" });
  }
  const merchantId = req.merchant?.sub as string;
  const query = userQuery.parse(req.query);
  const table = await getUserDirectory({ merchantIds: [merchantId], search: query.q || null, page: query.page, perPage: query.perPage });
  res.render("merchant/users", { title: "Clients", table, query });
});

// Ledger
router.get("/ledger", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;

  const entries = await prisma.ledgerEntry.findMany({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, amountCents: true, reason: true, createdAt: true },
  });

  res.render("merchant/ledger", { title: "Ledger", entries });
});

router.get("/accounts", (_req, res) => res.redirect("/merchant/accounts/settlements"));

router.get("/accounts/settlements", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  const [entries, merchant] = await Promise.all([
    listAccountEntries({ type: "SETTLEMENT", merchantId }),
    prisma.merchant.findUnique({ where: { id: merchantId }, select: { name: true, balanceCents: true } }),
  ]);

  res.render("merchant/accounts-settlements", {
    title: "Accounts · Settlements",
    entries,
    merchant,
  });
});

router.get("/accounts/topups", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  const [entries, merchant] = await Promise.all([
    listAccountEntries({ type: "TOPUP", merchantId }),
    prisma.merchant.findUnique({ where: { id: merchantId }, select: { name: true, balanceCents: true } }),
  ]);

  res.render("merchant/accounts-topups", {
    title: "Accounts · Topups",
    entries,
    merchant,
  });
});

// EXPORTS
router.post("/export/payments", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  if (!merchantId) return res.status(401).json({ ok: false, error: "Unauthorized" });

  try {
    const format = parseExportFormat(req.body?.type);
    const filters = coerceExportFilters(req.body?.filters);
    const columns = sanitizeColumns(req.body?.columns, MERCHANT_PAYMENT_EXPORT_COLUMNS);
    const { items, query } = await fetchPaymentsFromQuery(filters, merchantId);
    const typeContext: "DEPOSIT" | "WITHDRAWAL" | "ALL" =
      query.type === "DEPOSIT" ? "DEPOSIT" : query.type === "WITHDRAWAL" ? "WITHDRAWAL" : "ALL";
    const file = await buildPaymentExportFile({
      format,
      columns,
      items: items as unknown as PaymentExportItem[],
      context: { scope: "merchant", type: typeContext },
    });
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(file.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Unable to export payments" });
  }
});

router.get("/export/payments.csv", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  const { items } = await fetchPayments(req, merchantId);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="payments.csv"');
  const csv = stringify({
    header: true,
    columns: ["id","referenceCode","type","currency","amountCents","status","bank","createdAt","updatedAt","receipt"]
  });
  csv.pipe(res);
  for (const x of items) {
    csv.write({
      id: x.id,
      referenceCode: x.referenceCode,
      type: x.type,
      currency: x.currency,
      amountCents: x.amountCents,
      status: x.status,
      bank: x.bankAccount?.bankName ?? "",
      createdAt: x.createdAt.toISOString(),
      updatedAt: x.updatedAt.toISOString(),
      receipt: x.receiptFile?.original ?? "",
    });
  }
  csv.end();
});

router.get("/export/payments.xlsx", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  const { items } = await fetchPayments(req, merchantId);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Payments");
  ws.columns = [
    { header: "ID", key: "id", width: 28 },
    { header: "Reference", key: "referenceCode", width: 18 },
    { header: "Type", key: "type", width: 12 },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Amount (cents)", key: "amountCents", width: 16 },
    { header: "Status", key: "status", width: 12 },
    { header: "Bank", key: "bank", width: 20 },
    { header: "Created", key: "createdAt", width: 22 },
    { header: "Updated", key: "updatedAt", width: 22 },
    { header: "Receipt", key: "receipt", width: 28 },
  ];
  items.forEach(x => ws.addRow({
    id: x.id,
    referenceCode: x.referenceCode,
    type: x.type,
    currency: x.currency,
    amountCents: x.amountCents,
    status: x.status,
    bank: x.bankAccount?.bankName ?? "",
    createdAt: x.createdAt,
    updatedAt: x.updatedAt,
    receipt: x.receiptFile?.original ?? "",
  }));
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",'attachment; filename="payments.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

router.get("/export/ledger.csv", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  const entries = await prisma.ledgerEntry.findMany({
    where: { merchantId }, orderBy: { createdAt: "desc" }, take: 100
  });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="ledger.csv"');
  const csv = stringify({ header: true, columns: ["id","amountCents","reason","createdAt"] });
  csv.pipe(res);
  for (const e of entries) {
    csv.write({ id: e.id, amountCents: e.amountCents, reason: e.reason, createdAt: e.createdAt.toISOString() });
  }
  csv.end();
});

router.get("/export/ledger.xlsx", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  const entries = await prisma.ledgerEntry.findMany({
    where: { merchantId }, orderBy: { createdAt: "desc" }, take: 100
  });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Ledger");
  ws.columns = [
    { header: "ID", key: "id", width: 28 },
    { header: "Amount (cents)", key: "amountCents", width: 16 },
    { header: "Reason", key: "reason", width: 40 },
    { header: "Created", key: "createdAt", width: 22 },
  ];
  entries.forEach(e => ws.addRow(e));
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",'attachment; filename="ledger.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

router.get("/export/users.csv", async (req: any, res) => {
  if (!usersFeatureEnabled(res)) return res.status(403).send("Client directory disabled");
  const merchantId = req.merchant?.sub as string;
  const query = userQuery.parse(req.query);
  const items = await collectMerchantUsersForExport(merchantId, query.q || null);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="clients.csv"');
  const csv = stringify({
    header: true,
    columns: ["userId","fullName","email","phone","status","registeredAt","lastActivity"],
  });
  csv.pipe(res);
  items.forEach((user) => {
    csv.write({
      userId: user.publicId,
      fullName: user.fullName || "",
      email: user.email || "",
      phone: user.phone || "",
      status: user.verificationStatus,
      registeredAt: user.registeredAt.toISOString(),
      lastActivity: user.lastActivityAt ? user.lastActivityAt.toISOString() : "",
    });
  });
  csv.end();
});

router.get("/export/users.xlsx", async (req: any, res) => {
  if (!usersFeatureEnabled(res)) return res.status(403).send("Client directory disabled");
  const merchantId = req.merchant?.sub as string;
  const query = userQuery.parse(req.query);
  const items = await collectMerchantUsersForExport(merchantId, query.q || null);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Clients");
  ws.columns = [
    { header: "User ID", key: "userId", width: 16 },
    { header: "Full name", key: "fullName", width: 24 },
    { header: "Email", key: "email", width: 24 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Status", key: "status", width: 14 },
    { header: "Registered", key: "registeredAt", width: 24 },
    { header: "Last activity", key: "lastActivity", width: 24 },
  ];
  items.forEach((user) => {
    ws.addRow({
      userId: user.publicId,
      fullName: user.fullName || "",
      email: user.email || "",
      phone: user.phone || "",
      status: user.verificationStatus,
      registeredAt: user.registeredAt,
      lastActivity: user.lastActivityAt || null,
    });
  });
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",'attachment; filename="clients.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

router.get("/export/users.pdf", async (req: any, res) => {
  if (!usersFeatureEnabled(res)) return res.status(403).send("Client directory disabled");
  const merchantId = req.merchant?.sub as string;
  const query = userQuery.parse(req.query);
  const items = await collectMerchantUsersForExport(merchantId, query.q || null);
  const pdf = renderUserDirectoryPdf(items);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="clients.pdf"');
  res.end(pdf);
});

// API Keys
function genPrefix(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "m_";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
function genSecret(): string {
  return crypto.randomBytes(24).toString("base64url");
}

async function listMerchantApiKeys(merchantId: string) {
  return prisma.merchantApiKey.findMany({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      prefix: true,
      last4: true,
      active: true,
      scopes: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
  });
}

router.get("/keys", async (req: any, res) => {
  await renderMerchantApiKeys(req, res);
});

router.post("/prefs/theme", (req, res) => {
  const mode = (req.body?.mode === "dark") ? "dark" : "light";
  res.cookie("merchant_theme", mode, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 31536000 * 1000,
    secure: process.env.NODE_ENV === "production",
  });
  res.json({ ok: true, mode });
});

router.post("/prefs/timezone", async (req: any, res) => {
  const id = currentMerchantUserId(req);
  if (!id) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const timezoneRaw = normalizeTimezone(req.body?.timezone);
  const timezone = timezoneRaw ?? null;

  try {
    await prisma.merchantUser.update({
      where: { id },
      data: { timezone },
    });
    const resolved = resolveTimezone(timezone);
    res.locals.timezone = resolved;
    (req as any).activeTimezone = resolved;
    if (req.merchantAuth && typeof req.merchantAuth === "object") {
      req.merchantAuth.timezone = resolved;
    }
    return res.json({ ok: true, timezone: resolved });
  } catch (err) {
    console.error("[merchant prefs] failed to update timezone", err);
    return res.status(500).json({ ok: false, error: "Failed to save timezone" });
  }
});

router.post("/keys/create", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  const selfService = req.merchantDetails?.apiKeysSelfServiceEnabled !== false;
  if (!selfService) {
    res.status(403);
    await renderMerchantApiKeys(req, res, {
      error: "Self-service API key creation is disabled by your administrator.",
    });
    return;
  }
  const prefix = genPrefix();
  const secret = genSecret();
  await prisma.merchantApiKey.create({
    data: { merchantId, prefix, secretEnc: seal(secret), last4: secret.slice(-4), scopes: ["read:payments"] }
  });
  await renderMerchantApiKeys(req, res, { justCreated: `${prefix}.${secret}` });
});

router.post("/keys/:id/reveal", async (req: any, res) => {
  const config = getApiKeyRevealConfig();
  if (!config.allow) {
    return res.status(403).json({ ok: false, error: "disabled", message: "API key reveal is disabled." });
  }

  const merchantId = req.merchant?.sub as string;
  const user = req.merchantUser || null;
  if (!merchantId || !user?.id) {
    return res.status(403).json({ ok: false, error: "forbidden", message: "Not authorized." });
  }

  if (!user.canRevealApiKeys) {
    return res.status(403).json({ ok: false, error: "forbidden", message: "You do not have permission to reveal API keys." });
  }

  const payload = req.body || {};
  const password = typeof payload.password === "string" ? payload.password : undefined;
  const totp = typeof payload.totp === "string" ? payload.totp : undefined;
  const stepToken = typeof payload.stepToken === "string" ? payload.stepToken : undefined;

  try {
    const result = await revealApiKey({
      kind: "merchant",
      keyId: String(req.params.id || ""),
      merchantId,
      merchantUserId: user.id,
      password,
      totp,
      stepToken,
      ip: ipFromReq(req) || req.ip || null,
      userAgent: uaFromReq(req),
    });

    return res.json({
      ok: true,
      keyId: result.keyId,
      secret: result.secret,
      prefix: result.prefix,
      stepToken: result.stepToken,
      stepExpiresIn: result.stepExpiresIn,
      previousSuccessAt: result.previousSuccessAt ? result.previousSuccessAt.toISOString() : null,
      autoHideSeconds: config.autoHideSeconds,
    });
  } catch (err: any) {
    if (err instanceof ApiKeyRevealError) {
      const body: any = { ok: false, error: err.code, message: err.message };
      if (err.needsStepUp) body.needsStepUp = true;
      if (err.retryAt instanceof Date) body.retryAt = err.retryAt.toISOString();
      return res.status(err.status).json(body);
    }
    console.error("[merchant api key reveal] unexpected", err);
    return res.status(500).json({ ok: false, error: "server_error", message: "Unable to reveal API key right now." });
  }
});

router.post("/keys/:id/revoke", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  await prisma.merchantApiKey.updateMany({ where: { id: req.params.id, merchantId }, data: { active: false } });
  res.redirect("/merchant/keys");
});

router.post("/keys/:id/rotate", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  const selfService = req.merchantDetails?.apiKeysSelfServiceEnabled !== false;
  if (!selfService) {
    res.status(403);
    await renderMerchantApiKeys(req, res, {
      error: "Self-service API key rotation is disabled by your administrator.",
    });
    return;
  }
  await prisma.merchantApiKey.updateMany({ where: { id: req.params.id, merchantId }, data: { active: false } });
  const prefix = genPrefix(); const secret = genSecret();
  await prisma.merchantApiKey.create({
    data: { merchantId, prefix, secretEnc: seal(secret), last4: secret.slice(-4), scopes: ["read:payments"] }
  });
  res.redirect("/merchant/keys");
});

// Logout → go to public login
router.get("/logout", (_req, res) => {
  try {
    res.clearCookie("merchant_jwt", { path: "/" });
    res.clearCookie("merchant",     { path: "/" });
  } catch {}
  return res.redirect("/public/merchant/login");
});

export const merchantPortalRouter = router;
