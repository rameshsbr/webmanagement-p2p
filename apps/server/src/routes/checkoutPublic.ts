/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs";
import multer from "multer";
import { deriveDiditSubject } from "../lib/diditSubject.js";
import { prisma } from "../lib/prisma.js";
import { open as sbOpen, seal, tscmp } from "../services/secretBox.js";
import { signCheckoutToken, verifyCheckoutToken } from "../services/checkoutToken.js";
import { generateTransactionId, generateUniqueReference, generateUserId } from "../services/reference.js";
import {
  formatClientStatusLabel,
  getClientStatusBySubject,
  getMerchantClientStatus,
  normalizeClientStatus,
  upsertMerchantClientMapping,
  type ClientStatus,
} from "../services/merchantClient.js";
import { applyMerchantLimits } from "../middleware/merchantLimits.js";
import { tgNotify } from "../services/telegram.js";
import { evaluateNameMatch } from "../services/paymentStatus.js";
import { ensureMerchantMethod, isIdrV4Method, listMerchantMethods } from "../services/methods.js";
import { requireKycOrStartFlow } from "../services/kycGate.js";
import { adapters } from "../services/providers/index.js";

// ───────────────────────────────────────────────
// Minimal API-key verification (copied pattern)
// ───────────────────────────────────────────────
type VerifiedKey = { merchantId: string; keyId: string; scopes: string[] };

function readApiKeyHeader(req: any): { prefix: string; secret: string } | null {
  const raw = String(req.get("authorization") || req.get("x-api-key") || "");
  the: {
    /* eslint-disable no-labels */
  }
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
    stored = sbOpen(rec.secretEnc);
  } catch {
    return null;
  }
  if (!tscmp(stored, pk.secret)) return null;

  prisma.merchantApiKey.update({ where: { id: rec.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { merchantId: rec.merchantId, keyId: rec.id, scopes: rec.scopes ?? [] };
}

// ───────────────────────────────────────────────
// Multer uploads to /uploads (web-accessible)
// ───────────────────────────────────────────────
const uploadDir = path.join(process.cwd(), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const base = file.originalname.replace(/[^\w.\-]+/g, "_").slice(-100);
      cb(null, `${Date.now()}_${base}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ───────────────────────────────────────────────
const FALLBACK_MIN_CENTS = 50 * 100;
const FALLBACK_MAX_CENTS = 5000 * 100;

function rejectForClientStatus(res: any, status: ClientStatus) {
  const code = status === "BLOCKED" ? "CLIENT_BLOCKED" : "CLIENT_DEACTIVATED";
  const message =
    status === "BLOCKED"
      ? "This account is blocked and cannot perform deposits or withdrawals."
      : "This account is temporarily deactivated and cannot perform deposits or withdrawals.";
  return res.status(403).json({ ok: false, error: code, message });
}

const METHOD = z
  .string()
  .min(2)
  .max(32)
  .transform((v) => v.trim().toUpperCase());
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalizeAuMobile(input: string) {
  const digits = String(input || "").replace(/[^\d]/g, "");
  if (/^04\d{8}$/.test(digits)) return `+61${digits.slice(1)}`;
  if (/^614\d{8}$/.test(digits)) return `+61${digits.slice(2)}`;
  if (/^61\d{9}$/.test(digits)) return `+${digits}`;
  return input?.trim?.() || "";
}
const payerOsko = z.object({
  holderName: z.string().min(2),
  accountNo: z.string().regex(/^\d{10,12}$/),
  bsb: z.string().regex(/^\d{6}$/),
  bankName: z.string().min(1).optional(),
});
const payerPayId = z
  .object({
    holderName: z.string().min(2),
    payIdType: z.enum(["mobile", "email"]),
    payIdValue: z.preprocess((v) => (typeof v === "string" ? normalizeAuMobile(v) : v), z.string().min(3)),
    bankName: z.string().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.payIdType === "email") {
      if (!emailRe.test(val.payIdValue)) {
        ctx.addIssue({ code: "custom", path: ["payIdValue"], message: "Invalid email" });
      }
    } else if (!/^\+61\d{9}$/.test(val.payIdValue)) {
      ctx.addIssue({
        code: "custom",
        path: ["payIdValue"],
        message: "Invalid AU mobile (use 04xxxxxxxx or +61xxxxxxxxx)",
      });
    }
  });

// NEW: tolerant payer for IDR VA (Fazz)
const payerIdr = z.object({
  holderName: z.string().min(2),
  accountNo: z.string().min(1).optional(),
  bankName: z.string().min(1).optional(),
});
const destinationIdr = z.object({
  holderName: z.string().min(2),
  accountNo: z.string().min(3),
  bankCode: z.string().min(2),
  bankName: z.string().min(1).optional(),
});

function nowIso() { return new Date().toISOString(); }
function normalizeExactName(input: string) {
  return String(input || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function rejectInactiveClient(res: any, status: ClientStatus, action: "deposit" | "withdrawal") {
  const error = status === "BLOCKED" ? "CLIENT_BLOCKED" : "CLIENT_DEACTIVATED";
  const message =
    status === "BLOCKED"
      ? "Your account is blocked and cannot perform deposits or withdrawals."
      : "Your account is temporarily deactivated and cannot perform deposits or withdrawals.";
  return res.status(403).json({ ok: false, error, message, action, status: formatClientStatusLabel(status) });
}

// Auth via short-lived checkout token (browser)
function checkoutAuth(req: any, res: any, next: any) {
  const raw = String(req.get("authorization") || req.get("x-checkout-token") || "");
  const m = raw.match(/(?:Bearer\s+)?(.+)/);
  const token = m ? m[1] : null;
  if (!token) return res.status(401).json({ ok: false, error: "Missing checkout token" });
  const claims = verifyCheckoutToken(token);
  if (!claims) return res.status(401).json({ ok: false, error: "Invalid/expired token" });
  req.checkout = claims;
  req.merchantId = claims.merchantId;
  next();
}

export const checkoutPublicRouter = Router();

// ───────────────────────────────────────────────
// Helper to compute display fields from bankAccount.fields
// ───────────────────────────────────────────────
type CoreKey = "holderName"|"bankName"|"accountNo"|"iban"|"instructions";
const CORE_LABELS: Record<CoreKey, string> = {
  holderName: "Account Holder Name",
  bankName: "Bank Name",
  accountNo: "Account / PayID Value",
  iban: "IBAN",
  instructions: "Instructions",
};

// Fallback default order for core keys
const CORE_DEFAULT_ORDER: Record<CoreKey, number> = {
  holderName: 10,
  bankName: 20,
  accountNo: 30,
  iban: 40,
  instructions: 9999,
};

function computeDisplayFields(bank: any) {
  const f = (bank?.fields || {}) as any;
  const core = f.core || {};
  const extraArr = Array.isArray(f.extra) ? f.extra : [];

  const isVisible = (k: string) => {
    if (typeof core?.[k]?.visible === "boolean") return !!core[k].visible;
    return k === "iban" ? false : true;
  };

  const coreLabel = (k: CoreKey) => {
    const raw = (core?.[k]?.label ?? "").trim?.() || "";
    return raw || CORE_LABELS[k];
  };

  const coreOrder = (k: CoreKey) => {
    const n = Number(core?.[k]?.order);
    return Number.isFinite(n) ? n : (CORE_DEFAULT_ORDER[k] ?? 1000);
  };

  const visibleCore: Array<{key: string, label: string, value: any, type: string, order: number}> = [];

  (["holderName","bankName","accountNo","iban","instructions"] as CoreKey[]).forEach((k) => {
    if (!isVisible(k)) return;
    const val = (k === "instructions") ? (bank?.instructions ?? null) : (bank?.[k] ?? null);
    visibleCore.push({
      key: k,
      label: coreLabel(k),
      value: val,
      type: k === "instructions" ? "note" : "text",
      order: coreOrder(k),
    });
  });

  const EXTRAS_OFFSET = 1000;

  const extras = extraArr
    .filter((x: any) => x && x.visible)
    .map((x: any) => ({
      key: String(x.key || "").trim() || null,
      label: x.label || "",
      value: x.value || "",
      type: x.type || "text",
      order: Number(x.order ?? 0) + EXTRAS_OFFSET,
    }));

  const all = visibleCore.concat(extras).sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));

  return { core: visibleCore, extra: extras, all };
}

// ───────────────────────────────────────────────
// Form config helpers (per-merchant or per-bank)
// ───────────────────────────────────────────────
type UIField = {
  name: string;
  display: "input" | "file" | "select";
  field: "text" | "number" | "phone" | "email" | "phone_email" | null; // ← upgraded
  placeholder?: string;
  required?: boolean;
  minDigits?: number;
  maxDigits?: number | null;
  options?: string[];
};

function normalizeField(r: any): UIField | null {
  if (!r) return null;
  const name = String(r.name ?? r.key ?? "").trim();
  if (!name) return null;
  const displayRaw = String(r.display ?? r.mode ?? "input").toLowerCase();
  const display: "input" | "file" | "select" = displayRaw === "file" ? "file" : displayRaw === "select" ? "select" : "input";
  let field: UIField["field"] = null;
  if (display === "input") {
    const ft = String(r.field || "text").toLowerCase();
    field = (["text","number","phone","email","phone_email"] as const).includes(ft as any) ? (ft as UIField["field"]) : "text";
  }
  const placeholder = r.placeholder ?? "";
  const required = !!r.required;

  let minDigits = 0;
  let maxDigits: number | null = null;
  if (display === "input" && field === "number") {
    const minRaw = Number(r.minDigits);
    minDigits = Number.isFinite(minRaw) ? Math.max(0, Math.min(64, Math.floor(minRaw))) : 0;

    if (r.maxDigits === null || typeof r.maxDigits === "undefined" || r.maxDigits === "") {
      maxDigits = null;
    } else {
      const parsedMax = Number(r.maxDigits);
      if (Number.isFinite(parsedMax)) {
        maxDigits = Math.max(minDigits, Math.min(64, Math.floor(parsedMax)));
      }
    }
    const legacyDigits = Number(r.digits);
    if (Number.isFinite(legacyDigits) && legacyDigits > 0) {
      minDigits = 0;
      maxDigits = Math.max(minDigits, Math.min(64, Math.floor(legacyDigits)));
    }
  }

  let options: string[] = [];
  if (Array.isArray(r.options)) options = r.options.map((x: any) => String(x));
  else if (typeof r.data === "string") options = r.data.split(",").map((s: string) => s.trim()).filter(Boolean);

  return { name, display, field, placeholder, required, minDigits, maxDigits, options };
}

async function getFormConfig(merchantId: string, bankAccountId?: string | null) {
  if (!bankAccountId) {
    return { deposit: [] as UIField[], withdrawal: [] as UIField[] };
  }
  const rec = await prisma.merchantFormConfig.findFirst({ where: { merchantId, bankAccountId } });
  const dep = Array.isArray((rec as any)?.deposit) ? (rec as any).deposit : [];
  const wdr = Array.isArray((rec as any)?.withdrawal) ? (rec as any).withdrawal : [];
  const deposit = dep.map(normalizeField).filter(Boolean) as UIField[];
  const withdrawal = wdr.map(normalizeField).filter(Boolean) as UIField[];
  return { deposit, withdrawal };
}

function validateExtras(fields: UIField[], extras: any) {
  const data =
    extras && typeof extras === "object" && !Array.isArray(extras)
      ? (extras as Record<string, any>)
      : {};
  const sanitized: Record<string, any> = {};

  for (const f of fields) {
    if (!f || !f.name) continue;
    const key = f.name;
    const raw = data[key];
    const str = raw == null ? "" : String(raw);
    const trimmed = str.trim();

    if (f.required) {
      if (trimmed === "") {
        return { ok: false, error: `${f.name} is required.`, field: key };
      }
    }

    if (f.display === "select" && Array.isArray(f.options) && f.options.length) {
      if (trimmed && !f.options.includes(str)) {
        return { ok: false, error: `${f.name} has an invalid value.`, field: key };
      }
      sanitized[key] = str;
      continue;
    }

    // number input with digit bounds
    if (f.display === "input" && f.field === "number") {
      if (trimmed === "") {
        sanitized[key] = "";
        continue;
      }
      const normalized = trimmed.replace(/[\s-]+/g, "");
      if (!/^\d+$/.test(normalized)) {
        return { ok: false, error: "Enter digits only.", field: key };
      }
      const min = Number.isFinite(f.minDigits)
        ? Math.max(0, Math.floor(f.minDigits as number))
        : 0;
      const max =
        typeof f.maxDigits === "number" && Number.isFinite(f.maxDigits)
          ? Math.max(min, Math.floor(f.maxDigits as number))
          : null;
      const len = normalized.length;
      if (max !== null && min > 0 && (len < min || len > max)) {
        return { ok: false, error: `Enter between ${min} and ${max} digits.`, field: key };
      }
      if (min > 0 && len < min) {
        return { ok: false, error: `Enter at least ${min} digits.`, field: key };
      }
      if (max !== null && len > max) {
        return { ok: false, error: `Enter at most ${max} digits.`, field: key };
      }
      sanitized[key] = normalized;
      continue;
    }

    // NEW: phone / email / phone_email
    if (f.display === "input" && (f.field === "email" || f.field === "phone" || f.field === "phone_email")) {
      if (trimmed === "") {
        sanitized[key] = "";
        continue;
      }

      const looksLikeEmail = trimmed.includes("@");

      if (f.field === "email" || (f.field === "phone_email" && looksLikeEmail)) {
        if (!emailRe.test(trimmed)) {
          return { ok: false, error: "Enter a valid email address.", field: key };
        }
        sanitized[key] = trimmed;
        continue;
      }

      // phone or phone_email (phone branch)
      const normalized = normalizeAuMobile(trimmed);
      if (!/^\+61\d{9}$/.test(normalized)) {
        return { ok: false, error: "Enter a valid AU mobile (04xxxxxxxx or +61xxxxxxxxx).", field: key };
      }
      sanitized[key] = normalized;
      continue;
    }

    // default text-like
    sanitized[key] = trimmed;
  }

  return { ok: true, values: sanitized };
}

const WILDCARD_CURRENCIES = new Set(["ANY", "ALL"]);

function normalizeCurrencyCode(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}

function bankSupportsCurrency(bankCurrency: string | null | undefined, desiredCurrency: string | null | undefined) {
  const bankCode = normalizeCurrencyCode(bankCurrency);
  const desiredCode = normalizeCurrencyCode(desiredCurrency);
  if (!bankCode || !desiredCode) return true;
  if (bankCode === desiredCode) return true;
  return WILDCARD_CURRENCIES.has(bankCode);
}

async function loadMerchantBank(merchantId: string, bankAccountId: string) {
  if (!merchantId || !bankAccountId) return null;
  return prisma.bankAccount.findFirst({
    where: { id: bankAccountId, merchantId, active: true },
    select: {
      id: true,
      merchantId: true,
      currency: true,
      method: true,
      label: true,
      holderName: true,
      bankName: true,
      accountNo: true,
      iban: true,
      instructions: true,
      fields: true,
    },
  });
}

async function getAllowedMethodsForMerchant(merchantId: string) {
  const methods = await listMerchantMethods(merchantId);
  const map = new Map(methods.map((m) => [m.code.trim().toUpperCase(), m]));
  const codes = new Set(Array.from(map.keys()));
  return { methods, codes, map } as const;
}

// ───────────────────────────────────────────────
// 1) Server-to-server: create a checkout session (API key)
// ───────────────────────────────────────────────
checkoutPublicRouter.post(
  "/merchant/checkout/session",
  async (req: any, res, next) => {
    const auth = await verifyApiKey(req);
    if (!auth) return res.status(401).json({ ok: false, error: "API key required" });
    req.merchantId = auth.merchantId;
    req.apiKeyScopes = auth.scopes ?? [];
    next();
  },
  applyMerchantLimits,
  async (req: any, res) => {
    const UserInput = z.object({
      diditSubject: z.string().min(3).optional(),
      externalId: z.string().min(1).optional(),
      email: z.string().email().optional(),
    });

    const parsed = z
      .object({
        user: UserInput.refine((u) => !!(u.diditSubject || u.externalId), {
          message: "Provide user.externalId or user.diditSubject",
        }),
        currency: z.string().default("AUD"),
        availableBalanceCents: z.number().int().nonnegative().optional(),
      })
      .safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_FAILED",
        details: parsed.error.flatten(),
      });
    }
    const body = parsed.data;

    let diditSubject = body.user.diditSubject || null;
    const externalId = body.user.externalId || null;
    if (!diditSubject && externalId) {
      diditSubject = deriveDiditSubject(req.merchantId, externalId);
    }

    const clientStatus = await getClientStatusBySubject(req.merchantId, diditSubject!);
    if (clientStatus !== "ACTIVE") {
      return rejectInactiveClient(res, clientStatus, "deposit");
    }

    const token = signCheckoutToken({
      merchantId: req.merchantId,
      diditSubject: diditSubject!,
      externalId,
      email: body.user.email || null,
      currency: body.currency.toUpperCase(),
      availableBalanceCents: body.availableBalanceCents,
      clientStatus,
    });

    res.json({
      ok: true,
      token,
      clientStatus: formatClientStatusLabel(clientStatus),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
  }
);

// ───────────────────────────────────────────────
// 2a) Public: list active bank rails for method (merchant + global)
//     (now also returns method-level limits so FE can set min/max)
// ───────────────────────────────────────────────
checkoutPublicRouter.get("/public/deposit/banks", checkoutAuth, applyMerchantLimits, async (req: any, res) => {
  const { merchantId, currency, diditSubject } = req.checkout;
  const clientStatus = await getClientStatusBySubject(merchantId, diditSubject);
  if (clientStatus !== "ACTIVE") {
    return rejectInactiveClient(res, clientStatus, "deposit");
  }

  const { codes: allowedMethods, map: allowedMethodMap } = await getAllowedMethodsForMerchant(merchantId);
  if (!allowedMethods.size) return res.json({ ok: true, banks: [] });

  const requestedCurrency = normalizeCurrencyCode((req.query.currency as string) || currency || "");
  const requestedMethod = String(req.query.method || "").trim().toUpperCase();

  const currencyFilter = requestedCurrency
    ? [{ currency: requestedCurrency }, { currency: "ANY" }, { currency: "ALL" }]
    : null;

  const where: any = {
    merchantId,
    active: true,
    ...(currencyFilter ? { OR: currencyFilter } : {}),
    method: { in: Array.from(allowedMethods) },
  };
  if (requestedMethod) {
    if (!allowedMethods.has(requestedMethod)) return res.json({ ok: true, banks: [] });
    where.method = requestedMethod;
  }

  const rows = await prisma.bankAccount.findMany({
    where,
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, method: true, label: true, currency: true, active: true },
  });

  const banks = rows.map((b) => {
    const method = String(b.method || "").trim().toUpperCase();
    const methodLabel = (b.label || method || "").toString();
    const cfg = allowedMethodMap.get(method) as any | undefined;
    const minCents = Number.isFinite(cfg?.minDepositCents) ? Number(cfg.minDepositCents) :
                     Number.isFinite(cfg?.minCents) ? Number(cfg.minCents) : FALLBACK_MIN_CENTS;
    const maxCents = Number.isFinite(cfg?.maxDepositCents) ? Number(cfg.maxDepositCents) :
                     Number.isFinite(cfg?.maxCents) ? Number(cfg.maxCents) : FALLBACK_MAX_CENTS;

    return {
      id: b.id,
      method,
      methodLabel: methodLabel || method,
      currency: normalizeCurrencyCode(b.currency) || requestedCurrency,
      active: !!b.active,
      limits: { minCents, maxCents },
    };
  });

  res.json({ ok: true, banks });
});

// ───────────────────────────────────────────────
// NEW: expose per-merchant/bank form config for widget
// Optional ?bankAccountId=...
// ───────────────────────────────────────────────
checkoutPublicRouter.get("/public/forms", checkoutAuth, applyMerchantLimits, async (req: any, res) => {
  const { merchantId } = req.checkout;
  const bankAccountId = String(req.query.bankAccountId || "").trim() || null;
  const cfg = await getFormConfig(merchantId, bankAccountId);
  res.json({ ok: true, deposit: cfg.deposit, withdrawal: cfg.withdrawal });
});

// ───────────────────────────────────────────────
// 2b) Public: deposit intent (create or reuse) + optional bank selection
//             (validation now uses forms for the selected bank)
//             (and IDR v4 displayFields now use Fazz VA values)
// ───────────────────────────────────────────────
checkoutPublicRouter.post("/public/deposit/intent", checkoutAuth, applyMerchantLimits, async (req: any, res) => {
  const { merchantId, diditSubject, currency } = req.checkout;

  const { map: allowedMethodMap, codes: allowedMethodCodes } = await getAllowedMethodsForMerchant(merchantId);

  const intentSchema = z.object({
    amountCents: z.number().int().positive(),
    method: METHOD,
    // AU: OSKO/PAYID | IDR: tolerant IDR VA (Fazz)
    payer: z.union([payerOsko, payerPayId, payerIdr]),
    bankAccountId: z.string().cuid(),
    extraFields: z.record(z.any()).optional(),
  });
  const parsedIntent = intentSchema.safeParse(req.body || {});
  if (!parsedIntent.success) {
    return res.status(400).json({
      ok: false,
      error: "VALIDATION_FAILED",
      details: parsedIntent.error.flatten(),
    });
  }
  const base = parsedIntent.data;

  if (!allowedMethodCodes.has(base.method)) {
    return res.status(400).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }
  const selectedMethod: any = allowedMethodMap.get(base.method);

  // Pull min/max from method config; safe fallbacks
  const minCents = Number.isFinite(selectedMethod?.minDepositCents) ? Number(selectedMethod.minDepositCents) :
                   Number.isFinite(selectedMethod?.minCents) ? Number(selectedMethod.minCents) : FALLBACK_MIN_CENTS;
  const maxCents = Number.isFinite(selectedMethod?.maxDepositCents) ? Number(selectedMethod.maxDepositCents) :
                   Number.isFinite(selectedMethod?.maxCents) ? Number(selectedMethod.maxCents) : FALLBACK_MAX_CENTS;

  if (base.amountCents < minCents || base.amountCents > maxCents) {
    return res.status(400).json({ ok: false, error: "Amount out of range", limits: { minCents, maxCents } });
  }

  // Find or create user; enforce KYC gate
  const user = await prisma.user.upsert({
    where: { diditSubject },
    create: { publicId: generateUserId(), diditSubject, verifiedAt: null },
    update: {},
  });

  const mapping = await upsertMerchantClientMapping({
    merchantId,
    externalId: req.checkout.externalId,
    userId: user.id,
    email: req.checkout.email,
  });
  const clientStatus = normalizeClientStatus(mapping?.status);
  if (clientStatus !== "ACTIVE") {
    return rejectInactiveClient(res, clientStatus, "deposit");
  }

  const chosenBank = await loadMerchantBank(merchantId, base.bankAccountId);
  if (!chosenBank) {
    return res.status(400).json({ ok: false, error: "INVALID_BANK_SELECTION" });
  }
  if (String(chosenBank.method || "").toUpperCase() !== base.method) {
    return res.status(400).json({ ok: false, error: "METHOD_BANK_MISMATCH" });
  }
  if (!bankSupportsCurrency(chosenBank.currency, currency)) {
    return res.status(400).json({ ok: false, error: "BANK_CURRENCY_UNAVAILABLE" });
  }

  // Validate per-bank extra fields
  const forms = await getFormConfig(merchantId, chosenBank.id);
  const v = validateExtras(forms.deposit, base.extraFields || {});
  if (!v.ok)
    return res
      .status(400)
      .json({ ok: false, error: v.error, field: v.field || undefined });
  const sanitizedExtras = v.values || {};

  let kycGate;
  try {
    kycGate = await requireKycOrStartFlow({
      merchantId,
      userId: user.id,
      diditSubject,
      externalId: req.checkout.externalId,
      email: req.checkout.email,
      verifiedAt: user.verifiedAt,
    });
  } catch (err) {
    console.error("[deposit-intent] KYC start failed", err);
    return res.status(500).json({
      ok: false,
      error: "KYC_START_FAILED",
      message: "Unable to start verification.",
    });
  }
  if (!kycGate.allow) {
    return res.json({
      ok: false,
      error: "KYC_REQUIRED",
      kyc: { url: kycGate.url, sessionId: kycGate.sessionId },
      message: "Verification required before proceeding.",
    });
  }

  if (isIdrV4Method(base.method)) {
    const payerName = (base.payer as any)?.holderName?.trim() || "";
    const kycFirst = user.firstName ?? null;
    const kycLast = user.lastName ?? null;
    const kycFull = user.fullName ?? null;

    if (payerName && (kycFirst || kycLast || kycFull)) {
      const match = evaluateNameMatch(payerName, kycFirst, kycLast, kycFull);
      if (!match.allow || match.score < 0.6) {
        return res.json({
          ok: false,
          error: "NAME_MISMATCH",
          message: "Account holder name must match the verified KYC name",
        });
      }
    }
  }

  const display = computeDisplayFields(chosenBank);
  const referenceCode = generateTransactionId();
  const uniqueReference = generateUniqueReference();

  // Build intent payload (sealed, reused on /public/deposit/submit)
  const intentPayload = {
    merchantId,
    userId: user.id,
    currency,
    amountCents: base.amountCents,
    bankAccountId: chosenBank.id,
    method: base.method,
    methodId: selectedMethod?.id || null,
    payer: base.payer,
    extras: sanitizedExtras,
    referenceCode,
    uniqueReference,
    createdAt: nowIso(),
  } as const;

  let intentToken: string;
  try {
    intentToken = seal(JSON.stringify(intentPayload));
  } catch (err) {
    console.error("[deposit-intent] failed to seal payload", err);
    return res.status(500).json({ ok: false, error: "INTENT_ENCRYPTION_FAILED" });
  }

  // UPDATED: robust Fazz IDR detection
  const cur = String(currency || "").toUpperCase();
  const isFazzIdr =
    cur === "IDR" &&
    /(IDR|ID\s*VA|FAZZ|VIRTUAL[\s_-]*ACCOUNT)/i.test(base.method);

  if (isFazzIdr) {
    if (cur !== "IDR") {
      return res.status(400).json({ ok: false, error: "CURRENCY_MISMATCH" });
    }

    // Dynamic vs Static from method label
    const isDynamic = /DYNAMIC/i.test(base.method);
    const methodCode = isDynamic ? "VIRTUAL_BANK_ACCOUNT_DYNAMIC" : "VIRTUAL_BANK_ACCOUNT_STATIC";

    // Map bank name to Fazz bank codes (defaults to BCA)
    const bankNameRaw = String((base.payer as any)?.bankName || chosenBank?.bankName || "").trim().toUpperCase();
    const BANK_MAP: Record<string, string> = {
      "BCA": "BCA", "BANK CENTRAL ASIA": "BCA",
      "BNI": "BNI", "BANK NEGARA INDONESIA": "BNI",
      "BRI": "BRI", "BANK RAKYAT INDONESIA": "BRI",
      "MANDIRI": "MANDIRI", "BANK MANDIRI": "MANDIRI",
      "PERMATA": "PERMATA", "BANK PERMATA": "PERMATA",
      "CIMB": "CIMB", "CIMB NIAGA": "CIMB",
      "DANAMON": "DANAMON",
      "MAYBANK": "MAYBANK",
      "SEA BANK": "SEABANK", "SEABANK": "SEABANK",
    };
    const bankCode = BANK_MAP[bankNameRaw] || "BCA";

    try {
      const providerMod: any = await import("../services/providers/index.js");
      const adapter =
        providerMod?.fazz ||
        providerMod?.providers?.fazz ||
        providerMod?.default?.fazz;

      if (!adapter || typeof adapter.createDepositIntent !== "function") {
        return res.status(503).json({ ok: false, error: "PROVIDER_UNAVAILABLE" });
      }

      const out = await adapter.createDepositIntent({
        tid: referenceCode,
        uid: user.publicId,
        merchantId,
        methodCode,
        amountCents: base.amountCents,
        currency: "IDR",
        bankCode,
        kyc: { fullName: user.fullName || (user as any).displayName || "Customer", diditSubject },
      });

      // Provider-derived values
      const vaAccountNo = out?.va?.accountNo || null;
      const vaAccountName = out?.va?.accountName || "Virtual Account";
      const vaBankShort = out?.va?.bankCode || out?.instructions?.payment?.data?.attributes?.paymentMethod?.instructions?.bankShortCode || bankCode || "BCA";

      // Start from bank config fields, but **override values+labels** for VA
      const overridden = computeDisplayFields(chosenBank).all.map((item) => {
        if (item.key === "holderName") {
          return { ...item, label: "Account Holder Name", value: vaAccountName };
        }
        if (item.key === "bankName") {
          return { ...item, label: "Bank Name", value: vaBankShort };
        }
        if (item.key === "accountNo") {
          return { ...item, label: "Virtual Account Number", value: vaAccountNo };
        }
        return item;
      });

      const bankDetails = {
        holderName: vaAccountName,
        bankName: vaBankShort,
        accountNo: vaAccountNo,
        iban: null,
        instructions: out.instructions || chosenBank?.instructions || null,
        method: chosenBank?.method || base.method,
        label: chosenBank?.label || null,
        fields: chosenBank?.fields || null,
        displayFields: overridden, // <-- critical fix
      };

      return res.json({
        ok: true,
        referenceCode,
        uniqueReference,
        currency,
        amountCents: base.amountCents,
        intentToken,
        bankDetails,
        provider: "FAZZ",
        providerDetails: { va: out?.va ?? null },
        expiresAt: out.expiresAt || null,
        limits: { minCents, maxCents },
      });
    } catch (err) {
      console.error("[deposit-intent:fazz] failed", err);
      return res.status(502).json({ ok: false, error: "PROVIDER_ERROR" });
    }
  }

  // AU / other rails (existing behavior)
  return res.json({
    ok: true,
    referenceCode,
    uniqueReference,
    currency,
    amountCents: base.amountCents,
    intentToken,
    bankDetails: {
      holderName: chosenBank?.holderName || null,
      bankName: chosenBank?.bankName || null,
      accountNo: chosenBank?.accountNo || null,
      iban: chosenBank?.iban || null,
      instructions: chosenBank?.instructions || null,
      method: chosenBank?.method || null,
      label: chosenBank?.label || null,
      fields: chosenBank?.fields || null,
      displayFields: computeDisplayFields(chosenBank).all,
    },
    limits: { minCents, maxCents },
  });
});

// ───────────────────────────────────────────────
// 3) Public: deposit submission (create payment + attach receipt)
checkoutPublicRouter.post("/public/deposit/submit", checkoutAuth, applyMerchantLimits, upload.single("receipt"), async (req: any, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "Missing file" });

  const { merchantId, diditSubject } = req.checkout;
  const tokenRaw = String(req.body?.intentToken || "").trim();
  if (!tokenRaw) return res.status(400).json({ ok: false, error: "Missing intent" });

  let payload: any;
  try {
    payload = JSON.parse(sbOpen(tokenRaw));
  } catch (err) {
    console.warn("[deposit-submit] invalid token", err);
    return res.status(400).json({ ok: false, error: "Invalid intent" });
  }

  if (!payload || payload.merchantId !== merchantId) {
    return res.status(400).json({ ok: false, error: "Intent mismatch" });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || user.diditSubject !== diditSubject) {
    return res.status(403).json({ ok: false, error: "USER_MISMATCH" });
  }
  if (!user.verifiedAt) {
    return res.status(403).json({ ok: false, error: "KYC_REQUIRED" });
  }

  const clientStatus = await getMerchantClientStatus(merchantId, user.id);
  if (clientStatus !== "ACTIVE") {
    return rejectInactiveClient(res, clientStatus, "deposit");
  }

  const allowedMethod = await ensureMerchantMethod(merchantId, payload.method);
  if (!allowedMethod || (payload.methodId && allowedMethod.id !== payload.methodId)) {
    return res.status(400).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const bank = await loadMerchantBank(merchantId, payload.bankAccountId);
  if (!bank) return res.status(400).json({ ok: false, error: "BANK_INACTIVE" });
  if (String(bank.method || "").toUpperCase() !== payload.method) {
    return res.status(400).json({ ok: false, error: "METHOD_BANK_MISMATCH" });
  }
  if (!bankSupportsCurrency(bank.currency, payload.currency)) {
    return res.status(400).json({ ok: false, error: "BANK_CURRENCY_UNAVAILABLE" });
  }

  const forms = await getFormConfig(merchantId, bank.id);
  const v = validateExtras(forms.deposit, payload.extras || {});
  if (!v.ok)
    return res
      .status(400)
      .json({ ok: false, error: v.error, field: v.field || undefined });
  const sanitizedExtras = v.values || {};

  const relPath = "/uploads/" + req.file.filename;

  try {
    const { payment } = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.paymentRequest.findUnique({ where: { referenceCode: payload.referenceCode } });
      if (duplicate) {
        throw new Error("ALREADY_SUBMITTED");
      }

      const created = await tx.paymentRequest.create({
        data: {
          type: "DEPOSIT",
          status: "PENDING",
          amountCents: payload.amountCents,
          currency: payload.currency,
          referenceCode: payload.referenceCode,
          uniqueReference: payload.uniqueReference,
          merchantId,
          userId: payload.userId,
          bankAccountId: bank.id,
          methodId: payload.methodId || null,
          detailsJson: { method: payload.method, payer: payload.payer, extras: sanitizedExtras },
        },
      });

      const file = await tx.receiptFile.create({
        data: {
          path: relPath,
          mimeType: req.file.mimetype,
          size: req.file.size,
          original: req.file.originalname,
          paymentId: created.id,
        },
      });

      await tx.paymentRequest.update({
        where: { id: created.id },
        data: { receiptFileId: file.id },
      });

      return { payment: created };
    });

    await tgNotify(
      `🟢 Deposit submitted\nRef: <b>${payload.referenceCode}</b>\nAmount: ${payload.amountCents} ${payload.currency}\nRail: ${payload.method} / ${bank.bankName || '-'}`
    ).catch(() => {});

    res.json({
      ok: true,
      id: payment.id,
      referenceCode: payload.referenceCode,
      uniqueReference: payload.uniqueReference,
      currency: payload.currency,
      amountCents: payload.amountCents,
    });
  } catch (err) {
    if ((err as Error)?.message === "ALREADY_SUBMITTED") {
      return res.status(409).json({ ok: false, error: "Already submitted" });
    }
    console.error("[deposit-submit] failed", err);
    return res.status(500).json({ ok: false, error: "SUBMIT_FAILED" });
  }
});

// ───────────────────────────────────────────────
// 4) Public: create withdrawal (still merchant-level forms)
// ───────────────────────────────────────────────
checkoutPublicRouter.post("/public/withdrawals", checkoutAuth, applyMerchantLimits, async (req: any, res) => {
  const { merchantId, diditSubject, currency, availableBalanceCents } = req.checkout;
  const { map: allowedMethodMap, codes: allowedMethodCodes } = await getAllowedMethodsForMerchant(merchantId);

  const withdrawalSchema = z.object({
    amountCents: z.number().int().positive(),
    method: METHOD,
    destination: z.union([payerOsko, payerPayId, destinationIdr]),
    bankAccountId: z.string().cuid(),
    extraFields: z.record(z.any()).optional(),
  });
  const parsedWithdrawal = withdrawalSchema.safeParse(req.body || {});
  if (!parsedWithdrawal.success) {
    return res.status(400).json({
      ok: false,
      error: "VALIDATION_FAILED",
      details: parsedWithdrawal.error.flatten(),
    });
  }
  const body = parsedWithdrawal.data;

  if (!allowedMethodCodes.has(body.method)) {
    return res.status(400).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }
  const selectedMethod = allowedMethodMap.get(body.method) as any;

  // Per-method limits if present (fallback to global constants)
  const minCents = Number.isFinite(selectedMethod?.minWithdrawalCents) ? Number(selectedMethod.minWithdrawalCents) :
                   Number.isFinite(selectedMethod?.minCents) ? Number(selectedMethod.minCents) : FALLBACK_MIN_CENTS;
  const maxCents = Number.isFinite(selectedMethod?.maxWithdrawalCents) ? Number(selectedMethod.maxWithdrawalCents) :
                   Number.isFinite(selectedMethod?.maxCents) ? Number(selectedMethod.maxCents) : FALLBACK_MAX_CENTS;

  if (body.amountCents < minCents || body.amountCents > maxCents) {
    return res.status(400).json({ ok: false, error: "Amount out of range", limits: { minCents, maxCents } });
  }
  if (typeof availableBalanceCents === "number" && body.amountCents > availableBalanceCents) {
    return res.status(400).json({ ok: false, error: "INSUFFICIENT_BALANCE" });
  }

  const bank = await loadMerchantBank(merchantId, body.bankAccountId);
  if (!bank) return res.status(400).json({ ok: false, error: "INVALID_BANK_SELECTION" });
  if (String(bank.method || "").toUpperCase() !== body.method) {
    return res.status(400).json({ ok: false, error: "METHOD_BANK_MISMATCH" });
  }
  if (!bankSupportsCurrency(bank.currency, currency)) {
    return res.status(400).json({ ok: false, error: "BANK_CURRENCY_UNAVAILABLE" });
  }

  // Validate per-bank extra fields for withdrawals
  const forms = await getFormConfig(merchantId, bank.id);
  const v = validateExtras(forms.withdrawal, body.extraFields || {});
  if (!v.ok)
    return res
      .status(400)
      .json({ ok: false, error: v.error, field: v.field || undefined });
  const sanitizedExtras = v.values || {};

  const user = await prisma.user.findUnique({ where: { diditSubject } });
  if (!user || !user.verifiedAt) return res.status(403).json({ ok: false, error: "User not verified" });
  const mapping = await upsertMerchantClientMapping({
    merchantId,
    externalId: req.checkout.externalId,
    userId: user.id,
    email: req.checkout.email,
  });
  const clientStatus = normalizeClientStatus(mapping?.status);
  if (clientStatus !== "ACTIVE") {
    return rejectInactiveClient(res, clientStatus, "withdrawal");
  }

  const hasDeposit = await prisma.paymentRequest.findFirst({
    where: { userId: user.id, merchantId, type: "DEPOSIT", status: "APPROVED" },
  });
  if (!hasDeposit) {
    return res.status(403).json({ ok: false, error: "WITHDRAWAL_BLOCKED_NO_PRIOR_DEPOSIT" });
  }

  const isIdrV4Withdrawal = isIdrV4Method(body.method) || body.method === "FAZZ_SEND";
  if (isIdrV4Withdrawal) {
    const typedName = String((body.destination as any)?.holderName || "").trim();
    const kycFirst = user.firstName ?? null;
    const kycLast = user.lastName ?? null;
    const kycFull = user.fullName ?? null;

    if (typedName && (kycFirst || kycLast || kycFull)) {
      const match = evaluateNameMatch(typedName, kycFirst, kycLast, kycFull);
      if (!match.allow || match.score < 0.6) {
        return res.json({
          ok: false,
          error: "NAME_MISMATCH",
          message: "Account holder name must match the verified KYC name",
        });
      }
    }

    const bankCode = String((body.destination as any)?.bankCode || (body.destination as any)?.bankName || "").trim();
    const accountNo = String((body.destination as any)?.accountNo || "").trim();
    if (!bankCode || !accountNo || !typedName) {
      return res.json({
        ok: false,
        error: "VALIDATOR_NAME_MISMATCH",
        message: "Account name must match with validator",
      });
    }

    try {
      const out = await adapters.fazz.validateBankAccount({ bankCode, accountNo, name: typedName });
      const validatedName = out?.holder || "";
      if (!out?.ok || !validatedName || normalizeExactName(validatedName) !== normalizeExactName(typedName)) {
        return res.json({
          ok: false,
          error: "VALIDATOR_NAME_MISMATCH",
          message: "Account name must match with validator",
        });
      }
    } catch (err) {
      console.error("[withdrawal-validate] failed", err);
      return res.json({
        ok: false,
        error: "VALIDATOR_NAME_MISMATCH",
        message: "Account name must match with validator",
      });
    }
  }

  let destRecord;
  if (isIdrV4Withdrawal) {
    const d = body.destination as any;
    const bankName = String(d.bankCode || d.bankName || "").trim() || "IDR";
    destRecord = await prisma.withdrawalDestination.create({
      data: {
        userId: user.id,
        currency,
        bankName,
        holderName: d.holderName,
        accountNo: d.accountNo,
        iban: null,
      },
    });
  } else if (body.method === "OSKO") {
    const d = body.destination as z.infer<typeof payerOsko>;
    const bankName = (d.bankName || "").trim() || "OSKO";
    destRecord = await prisma.withdrawalDestination.create({
      data: {
        userId: user.id,
        currency,
        bankName,
        holderName: d.holderName,
        accountNo: d.accountNo,
        iban: null,
      },
    });
  } else {
    const d = body.destination as z.infer<typeof payerPayId>;
    const bankName = (d.bankName || "").trim() || `PAYID-${d.payIdType.toUpperCase()}`;
    destRecord = await prisma.withdrawalDestination.create({
      data: {
        userId: user.id,
        currency,
        bankName,
        holderName: d.holderName,
        accountNo: d.payIdValue,
        iban: null,
      },
    });
  }

  const referenceCode = generateTransactionId();
  const uniqueReference = generateUniqueReference();
  const pr = await prisma.paymentRequest.create({
    data: {
      type: "WITHDRAWAL",
      status: "PENDING",
      amountCents: body.amountCents,
      currency,
      referenceCode,
      uniqueReference,
      merchantId,
      userId: user.id,
      bankAccountId: bank.id,
      methodId: selectedMethod?.id || null,
      detailsJson: { method: body.method, destination: body.destination, destinationId: destRecord.id, extras: sanitizedExtras },
    },
  });

  await tgNotify(`🟡 WITHDRAWAL request\nRef: <b>${referenceCode}</b>\nAmount: ${body.amountCents} ${currency}`).catch(() => {});
  res.json({ ok: true, id: pr.id, referenceCode, uniqueReference });
});

// ───────────────────────────────────────────────
// 5) Public: reusable deposit draft
checkoutPublicRouter.get("/public/deposit/draft", checkoutAuth, applyMerchantLimits, async (req: any, res) => {
  const { merchantId, diditSubject, currency, availableBalanceCents } = req.checkout;
  const user = await prisma.user.findUnique({ where: { diditSubject } });
  const claims = {
    merchantId,
    diditSubject,
    currency,
    availableBalanceCents,
    kycFullName: user?.fullName ?? null,
    kycFirstName: user?.firstName ?? null,
    kycLastName: user?.lastName ?? null,
  };
  if (!user) return res.json({ ok: true, draft: null, claims });

  const pr = await prisma.paymentRequest.findFirst({
    where: {
      type: "DEPOSIT",
      merchantId,
      userId: user.id,
      currency,
      status: "PENDING",
      receipts: { none: {} },
    },
  });

  res.json({ ok: true, draft: pr || null, claims });
});

// ───────────────────────────────────────────────
// 6) KYC: start + status (Didit low-code link)
checkoutPublicRouter.post("/public/kyc/start", checkoutAuth, applyMerchantLimits, async (req: any, res) => {
  const { diditSubject, merchantId, email, externalId } = req.checkout;

  const user = await prisma.user.upsert({
    where: { diditSubject },
    create: { publicId: generateUserId(), diditSubject, verifiedAt: null },
    update: {},
  });
  await upsertMerchantClientMapping({ merchantId, externalId, userId: user.id, email });

  let url: string | null = null;
  try {
    const didit = await import("../services/didit.js");
    if (typeof didit.createLowCodeLink === "function") {
      const out = await didit.createLowCodeLink({
        subject: diditSubject,
        merchantId,
        externalId,
        email,
        request: req,
      });
      url = out.url;

      // Idempotent write to avoid P2002 when the same session is returned twice
      await prisma.kycVerification.upsert({
        where: { externalSessionId: out.sessionId },
        create: { userId: user.id, provider: "didit", status: "pending", externalSessionId: out.sessionId },
        update: { userId: user.id },
      });
    }
  } catch (e) {
    console.warn("[public/kyc/start] real KYC link failed, will fallback to fake", (e as any)?.message || e);
  }

  if (!url) url = "/fake-didit";
  res.json({ ok: true, url });
});

checkoutPublicRouter.get("/public/kyc/status", checkoutAuth, applyMerchantLimits, async (req: any, res) => {
  const { diditSubject, merchantId, externalId, email } = req.checkout;
  const sessionId = String(req.query?.sessionId || "").trim();
  const user = await prisma.user.findUnique({ where: { diditSubject } });
  if (user) {
    await upsertMerchantClientMapping({ merchantId, userId: user.id, externalId, email });
  }
  if (!user) return res.json({ ok: true, status: "pending" });

  if (user.verifiedAt) return res.json({ ok: true, status: "approved" });

  if (sessionId) {
    try {
      const didit = await import("../services/didit.js");
      if (typeof didit.getVerificationStatus === "function") {
        const status = await didit.getVerificationStatus(sessionId);
        if (status === "approved") {
          await prisma.user.update({ where: { id: user.id }, data: { verifiedAt: new Date() } });
          await prisma.kycVerification.updateMany({
            where: { externalSessionId: sessionId },
            data: { status: "approved" },
          });
          return res.json({ ok: true, status: "approved" });
        }
        if (status === "rejected") {
          await prisma.kycVerification.updateMany({
            where: { externalSessionId: sessionId },
            data: { status: "rejected" },
          });
          return res.json({ ok: true, status: "rejected" });
        }
        return res.json({ ok: true, status });
      }
    } catch {}
  }

  const last = await prisma.kycVerification.findFirst({
    where: { userId: user.id, provider: "didit" },
    orderBy: { createdAt: "desc" },
  });

  if (last?.externalSessionId) {
    try {
      const didit = await import("../services/didit.js");
      if (typeof didit.getVerificationStatus === "function") {
        const s = await didit.getVerificationStatus(last.externalSessionId);
        if (s === "approved") {
          await prisma.user.update({ where: { id: user.id }, data: { verifiedAt: new Date() } });
          await prisma.kycVerification.update({ where: { id: last.id }, data: { status: "approved" } });
          return res.json({ ok: true, status: "approved" });
        }
        if (s === "rejected") {
          await prisma.kycVerification.update({ where: { id: last.id }, data: { status: "rejected" } });
          return res.json({ ok: true, status: "rejected" });
        }
      }
    } catch {}
  }

  res.json({ ok: true, status: last?.status || "pending" });
});

// ───────────────────────────────────────────────
// 7) Public: KYC done landing page
checkoutPublicRouter.get("/public/kyc/done", (_req: any, res: any) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <title>KYC Complete</title>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <style>
      :root { --ok:#16a34a; --bad:#dc2626; --muted:#666; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto;
             display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
      .card { padding:24px 28px; border:1px solid #eee; border-radius:16px; width:min(520px, 90%); text-align:center; }
      .icon { font-size:48px; line-height:1; margin-bottom:8px; }
      .ok { color: var(--ok); }
      .bad { color: var(--bad); }
      .sub { color: var(--muted); margin-top:8px; }
      .actions { margin-top:16px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap; }
      button, a.btn {
        margin-top:0; padding:10px 16px; border-radius:10px; border:1px solid #ddd; background:#fafafa;
        cursor:pointer; text-decoration:none; color:inherit; display:inline-block;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div id="icon" class="icon ok">✅</div>
      <h2 id="title">KYC step finished</h2>
      <div id="subtitle" class="sub">You can close this tab and return to the checkout.</div>
      <div class="actions">
        <button id="closeBtn">Close</button>
        <a id="backBtn" class="btn" href="javascript:history.back()">Back</a>
      </div>
    </div>

    <script>
      (function () {
        const qp = new URLSearchParams(location.search);
        const status = String(qp.get("status") || "").toLowerCase();
        const session = qp.get("session") || qp.get("verificationSessionId") || "";
        const vendor = qp.get("vendor") || qp.get("diditSubject") || "";
        const returnUrl = qp.get("return") || "";

        const icon = document.getElementById("icon");
        const title = document.getElementById("title");
        const subtitle = document.getElementById("subtitle");
        if (status === "rejected" || status === "declined" || status === "failed") {
          icon.textContent = "❌";
          icon.classList.remove("ok");
          icon.classList.add("bad");
          title.textContent = "KYC verification failed";
          subtitle.textContent = "Close this window to return to the checkout and try again.";
        } else if (status === "approved") {
          icon.textContent = "✅";
          title.textContent = "KYC verified";
          subtitle.textContent = "You can close this window and continue.";
        }

        const payload = { source: "payments-platform", type: "kyc.complete", status: status || "unknown", sessionId: session, diditSubject: vendor };
        try { if (window.opener) window.opener.postMessage(payload, "*"); } catch (e) {}
        try { if (window.parent && window.parent !== window) window.parent.postMessage(payload, "*"); } catch (e) {}

        function tryCloseWindow() {
          try { window.close(); } catch (e) {}
          if (typeof window.closed === "boolean" && window.closed) return true;
          try { window.open("", "_self"); window.close(); } catch (e) {}
          if (typeof window.closed === "boolean" && window.closed) return true;
          try { if (window.top && window.top !== window) { window.top.close(); } } catch (e) {}
          return (typeof window.closed === "boolean" && window.closed);
        }

        document.getElementById("closeBtn").addEventListener("click", function () {
          if (tryCloseWindow()) return;
          if (returnUrl) { location.replace(returnUrl); return; }
          if (document.referrer) { history.back(); return; }
        });
      })();
    </script>
  </body>
</html>`);
});
