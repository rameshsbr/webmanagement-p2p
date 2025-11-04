import { Router } from "express";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs";
import multer from "multer";
import { prisma } from "../lib/prisma.js";
import { open as sbOpen, tscmp } from "../services/secretBox.js";
import { signCheckoutToken, verifyCheckoutToken } from "../services/checkoutToken.js";
import { generateReference } from "../services/reference.js";
import { applyMerchantLimits } from "../middleware/merchantLimits.js";
import { tgNotify } from "../services/telegram.js";

// ───────────────────────────────────────────────
// Minimal API-key verification (copied pattern)
// ───────────────────────────────────────────────
type VerifiedKey = { merchantId: string; keyId: string; scopes: string[] };

function readApiKeyHeader(req: any): { prefix: string; secret: string } | null {
  const raw = String(req.get("authorization") || req.get("x-api-key") || "");
  the:
  {
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
const CURRENCY = "AUD";
const MIN_CENTS = 50 * 100;
const MAX_CENTS = 5000 * 100;

const METHOD = z.enum(["OSKO", "PAYID"]);
const payerOsko = z.object({
  holderName: z.string().min(2),
  accountNo: z.string().regex(/^\d{10,12}$/),
  bsb: z.string().regex(/^\d{6}$/),
});
const payerPayId = z.object({
  holderName: z.string().min(2),
  payIdType: z.enum(["mobile", "email"]),
  payIdValue: z.union([z.string().email(), z.string().regex(/^\+?61\d{9}$/)]),
});

function nowIso() { return new Date().toISOString(); }

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
// NOTE: instructions intentionally very high so it always renders last.
const CORE_DEFAULT_ORDER: Record<CoreKey, number> = {
  holderName: 10,
  bankName: 20,
  accountNo: 30,
  iban: 40,
  instructions: 9999, // <- keep at the bottom
};

function computeDisplayFields(bank: any) {
  const f = (bank?.fields || {}) as any;
  const core = f.core || {};
  const extraArr = Array.isArray(f.extra) ? f.extra : [];

  // Helper: visible?
  const isVisible = (k: string) => {
    if (typeof core?.[k]?.visible === "boolean") return !!core[k].visible;
    return k === "iban" ? false : true; // default visibility
  };

  // Helper: label (override if present)
  const coreLabel = (k: CoreKey) => {
    const raw = (core?.[k]?.label ?? "").trim?.() || "";
    return raw || CORE_LABELS[k];
  };

  // Helper: order
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

  // Ensure extras always come AFTER core fields visually.
  // We offset extras by +1000 so they never interleave ahead of core.
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

  // sort all by order number
  const all = visibleCore.concat(extras).sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));

  return { core: visibleCore, extra: extras, all };
}

// ───────────────────────────────────────────────
// Form config helpers (per-merchant or per-bank)
// ───────────────────────────────────────────────
type UIField = {
  name: string;
  display: "input" | "file" | "select";
  field: "text" | "number" | null;
  placeholder?: string;
  required?: boolean;
  digits?: number;
  options?: string[];
};

function normalizeField(r: any): UIField | null {
  if (!r) return null;
  const name = String(r.name ?? r.key ?? "").trim();
  if (!name) return null;
  const displayRaw = String(r.display ?? r.mode ?? "input").toLowerCase();
  const display: "input" | "file" | "select" = displayRaw === "file" ? "file" : displayRaw === "select" ? "select" : "input";
  const field = display === "input" ? (String(r.field || "text").toLowerCase() === "number" ? "number" : "text") : null;
  const placeholder = r.placeholder ?? "";
  const required = !!r.required;
  const digits = Number.isFinite(+r.digits) ? Math.max(0, +r.digits) : 0;
  let options: string[] = [];
  if (Array.isArray(r.options)) options = r.options.map((x: any) => String(x));
  else if (typeof r.data === "string") options = r.data.split(",").map((s: string) => s.trim()).filter(Boolean);
  return { name, display, field, placeholder, required, digits, options };
}

async function getFormConfig(merchantId: string, bankAccountId?: string | null) {
  // Try bank-specific first if provided, then fallback to merchant-level (null)
  let rec = null as any;
  if (bankAccountId) {
    rec = await prisma.merchantFormConfig.findFirst({ where: { merchantId, bankAccountId } });
  }
  if (!rec) {
    rec = await prisma.merchantFormConfig.findFirst({ where: { merchantId, bankAccountId: null } });
  }
  const dep = Array.isArray((rec as any)?.deposit) ? (rec as any).deposit : [];
  const wdr = Array.isArray((rec as any)?.withdrawal) ? (rec as any).withdrawal : [];
  const deposit = dep.map(normalizeField).filter(Boolean) as UIField[];
  const withdrawal = wdr.map(normalizeField).filter(Boolean) as UIField[];
  return { deposit, withdrawal };
}

function validateExtras(fields: UIField[], extras: any) {
  const data = extras && typeof extras === "object" ? extras : {};
  for (const f of fields) {
    const v = data[f.name];
    if (f.required) {
      const missing = v == null || (typeof v === "string" && v.trim() === "");
      if (missing) return { ok: false, error: `Missing field: ${f.name}` };
    }
    if (f.display === "select" && f.options && f.options.length) {
      if (v != null && !f.options.includes(String(v))) {
        return { ok: false, error: `Invalid option for ${f.name}` };
      }
    }
    if (f.display === "input" && f.field === "number") {
      if (v != null && String(v).trim() !== "") {
        if (!/^\d+$/.test(String(v))) return { ok: false, error: `Digits only in ${f.name}` };
        if (f.digits && f.digits > 0 && String(v).length !== f.digits) {
          return { ok: false, error: `${f.name} must be ${f.digits} digits` };
        }
      }
    }
  }
  return { ok: true };
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
    const body = z.object({
      user: z.object({ diditSubject: z.string().min(3) }),
      currency: z.string().default("AUD"),
      availableBalanceCents: z.number().int().nonnegative().optional(),
    }).parse(req.body || {});

    const token = signCheckoutToken({
      merchantId: req.merchantId,
      diditSubject: body.user.diditSubject,
      currency: body.currency.toUpperCase(),
      availableBalanceCents: body.availableBalanceCents,
    });

    res.json({ ok: true, token, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() });
  }
);

// ───────────────────────────────────────────────
// 2a) Public: list active bank rails for method (merchant + global)
// ───────────────────────────────────────────────
checkoutPublicRouter.get("/public/deposit/banks", checkoutAuth, applyMerchantLimits, async (req: any, res) => {
  const { merchantId, currency } = req.checkout;
  const method = METHOD.parse(String(req.query.method || "OSKO").toUpperCase());

  if (currency !== "AUD") return res.status(400).json({ ok: false, error: "AUD only" });

  const rows = await prisma.bankAccount.findMany({
    where: {
      active: true,
      currency,
      method,
      OR: [{ merchantId }, { merchantId: null }],
    },
    orderBy: [{ merchantId: "desc" }, { createdAt: "desc" }],
    select: {
      id: true, merchantId: true, bankName: true, holderName: true,
      accountNo: true, iban: true, label: true, instructions: true, method: true,
      fields: true,
    },
  });

  const banks = rows.map((b) => {
    const display = computeDisplayFields(b);
    return {
      id: b.id,
      label: b.label || `${b.bankName} • ${String(b.accountNo || "").slice(-4)}`,
      bankName: b.bankName,
      holderName: b.holderName,
      accountNo: b.accountNo,
      iban: b.iban,
      instructions: b.instructions || null,
      method: b.method,
      scope: b.merchantId ? "MERCHANT" : "GLOBAL",
      fields: b.fields || null,
      displayFields: display.all,
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
// ───────────────────────────────────────────────
checkoutPublicRouter.post("/public/deposit/intent", checkoutAuth, applyMerchantLimits, async (req: any, res) => {
  const { merchantId, diditSubject, currency } = req.checkout;

  const base = z.object({
    amountCents: z.number().int().positive(),
    method: METHOD,
    payer: z.union([payerOsko, payerPayId]),
    bankAccountId: z.string().cuid().optional(),
    extraFields: z.record(z.any()).optional(),
  }).parse(req.body || {});

  if (currency !== "AUD") return res.status(400).json({ ok: false, error: "AUD only" });
  if (base.amountCents < MIN_CENTS || base.amountCents > MAX_CENTS) {
    return res.status(400).json({ ok: false, error: "Amount out of range" });
  }

  // Find or create user; enforce KYC gate
  const user = await prisma.user.upsert({
    where: { diditSubject },
    create: { diditSubject, verifiedAt: null },
    update: {},
  });
  if (!user.verifiedAt) {
    return res.status(403).json({ ok: false, error: "KYC_REQUIRED" });
  }

  // Determine bank rail (explicit or auto-pick)
  let chosenBank: any | null = null;

  if (base.bankAccountId) {
    chosenBank = await prisma.bankAccount.findFirst({
      where: {
        id: base.bankAccountId,
        active: true,
        currency,
        method: base.method,
        OR: [{ merchantId }, { merchantId: null }],
      },
    });
    if (!chosenBank) {
      return res.status(400).json({ ok: false, error: "INVALID_BANK_SELECTION" });
    }
  }

  // Reuse a draft if exists (PENDING, no receipts)
  let pr = await prisma.paymentRequest.findFirst({
    where: {
      type: "DEPOSIT",
      merchantId,
      userId: user.id,
      currency,
      status: "PENDING",
      receipts: { none: {} },
    },
    orderBy: { createdAt: "desc" },
    include: { bankAccount: true },
  });

  // If no explicit choice, pick newest active rail for this method (merchant-first, then global)
  if (!chosenBank) {
    chosenBank =
      (await prisma.bankAccount.findFirst({
        where: { active: true, merchantId, currency, method: base.method },
        orderBy: { createdAt: "desc" },
      })) ||
      (await prisma.bankAccount.findFirst({
        where: { active: true, merchantId: null, currency, method: base.method },
        orderBy: { createdAt: "desc" },
      }));
  }
  if (!chosenBank) return res.status(400).json({ ok: false, error: "No bank account for method" });

  // Validate per-bank extra fields (fallback to merchant-level if no bank-specific config)
  const forms = await getFormConfig(merchantId, chosenBank.id);
  const v = validateExtras(forms.deposit, base.extraFields || {});
  if (!v.ok) return res.status(400).json({ ok: false, error: v.error });

  // If reusing a draft but rail/method changed, update it
  if (pr) {
    const mustSwapRail =
      !pr.bankAccount ||
      pr.bankAccount.method !== base.method ||
      (base.bankAccountId && pr.bankAccount.id !== base.bankAccountId);

    pr = await prisma.paymentRequest.update({
      where: { id: pr.id },
      data: {
        amountCents: base.amountCents,
        bankAccountId: mustSwapRail ? chosenBank.id : pr.bankAccountId,
        detailsJson: { method: base.method, payer: base.payer, extras: base.extraFields || {} },
      },
      include: { bankAccount: true },
    });
  } else {
    pr = await prisma.paymentRequest.create({
      data: {
        type: "DEPOSIT",
        status: "PENDING",
        amountCents: base.amountCents,
        currency,
        referenceCode: generateReference("DEP"),
        merchantId,
        userId: user.id,
        bankAccountId: chosenBank.id,
        detailsJson: { method: base.method, payer: base.payer, extras: base.extraFields || {} },
      },
      include: { bankAccount: true },
    });
  }

  // include bank.fields for display
  const bankFull = await prisma.bankAccount.findUnique({
    where: { id: pr.bankAccountId || "" },
    select: {
      holderName: true, bankName: true, accountNo: true, iban: true, instructions: true, method: true, label: true, fields: true
    }
  });

  const display = computeDisplayFields({ ...bankFull, fields: bankFull?.fields });

  await tgNotify(
    `🟢 DEPOSIT intent\nRef: <b>${pr.referenceCode}</b>\nAmount: ${base.amountCents} ${currency}\nRail: ${bankFull?.method || "-"} / ${bankFull?.bankName || "-"}`
  ).catch(() => {});

  res.json({
    ok: true,
    id: pr.id,
    referenceCode: pr.referenceCode,
    currency: pr.currency,
    amountCents: pr.amountCents,
    bankDetails: {
      holderName: bankFull?.holderName || null,
      bankName: bankFull?.bankName || null,
      accountNo: bankFull?.accountNo || null,
      iban: bankFull?.iban || null,
      instructions: bankFull?.instructions || null,
      method: bankFull?.method || null,
      label: bankFull?.label || null,
      fields: bankFull?.fields || null,       // raw config
      displayFields: display.all,             // convenient ordered list
    },
  });
});

// ───────────────────────────────────────────────
// 3) Public: deposit receipt upload (append)
checkoutPublicRouter.post("/public/deposit/:id/receipt", checkoutAuth, applyMerchantLimits, upload.single("receipt"), async (req: any, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "Missing file" });
  const { merchantId, diditSubject } = req.checkout;
  const id = req.params.id;

  const pr = await prisma.paymentRequest.findUnique({
    where: { id },
    select: { id: true, merchantId: true, user: { select: { diditSubject: true } }, receiptFileId: true, referenceCode: true },
  });
  if (!pr || pr.merchantId !== merchantId || pr.user?.diditSubject !== diditSubject) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }

  const relPath = "/uploads/" + req.file.filename;

  const file = await prisma.receiptFile.create({
    data: {
      path: relPath,
      mimeType: req.file.mimetype,
      size: req.file.size,
      original: req.file.originalname,
      paymentId: pr.id,
    },
  });

  await prisma.paymentRequest.update({
    where: { id: pr.id },
    data: {
      status: "SUBMITTED",
      ...(pr.receiptFileId ? {} : { receiptFileId: file.id }),
    },
  });

  await tgNotify(`📄 Deposit SUBMITTED\nRef: <b>${pr.referenceCode}</b>`).catch(() => {});
  res.json({ ok: true, fileId: file.id });
});

// ───────────────────────────────────────────────
// 4) Public: create withdrawal (still merchant-level forms)
// ───────────────────────────────────────────────
checkoutPublicRouter.post("/public/withdrawals", checkoutAuth, applyMerchantLimits, async (req: any, res) => {
  const { merchantId, diditSubject, currency, availableBalanceCents } = req.checkout;

  const body = z.object({
    amountCents: z.number().int().positive(),
    method: METHOD,
    destination: z.union([payerOsko, payerPayId]),
    extraFields: z.record(z.any()).optional(),
  }).parse(req.body || {});

  if (currency !== "AUD") return res.status(400).json({ ok: false, error: "AUD only" });
  if (body.amountCents < MIN_CENTS || body.amountCents > MAX_CENTS) {
    return res.status(400).json({ ok: false, error: "Amount out of range" });
  }
  if (typeof availableBalanceCents === "number" && body.amountCents > availableBalanceCents) {
    return res.status(400).json({ ok: false, error: "INSUFFICIENT_BALANCE" });
  }

  // Validate merchant-level extra fields for withdrawals
  const forms = await getFormConfig(merchantId, null);
  const v = validateExtras(forms.withdrawal, body.extraFields || {});
  if (!v.ok) return res.status(400).json({ ok: false, error: v.error });

  const user = await prisma.user.findUnique({ where: { diditSubject } });
  if (!user || !user.verifiedAt) return res.status(403).json({ ok: false, error: "User not verified" });

  const hasDeposit = await prisma.paymentRequest.findFirst({
    where: { userId: user.id, merchantId, type: "DEPOSIT", status: "APPROVED" },
  });
  if (!hasDeposit) {
    return res.status(403).json({ ok: false, error: "WITHDRAWAL_BLOCKED_NO_PRIOR_DEPOSIT" });
  }

  let destRecord;
  if (body.method === "OSKO") {
    const d = body.destination as z.infer<typeof payerOsko>;
    destRecord = await prisma.withdrawalDestination.create({
      data: { userId: user.id, currency, bankName: "OSKO", holderName: d.holderName, accountNo: d.accountNo, iban: null },
    });
  } else {
    const d = body.destination as z.infer<typeof payerPayId>;
    destRecord = await prisma.withdrawalDestination.create({
      data: {
        userId: user.id,
        currency,
        bankName: `PAYID-${d.payIdType.toUpperCase()}`,
        holderName: d.holderName,
        accountNo: d.payIdValue,
        iban: null,
      },
    });
  }

  const referenceCode = generateReference("WDR");
  const pr = await prisma.paymentRequest.create({
    data: {
      type: "WITHDRAWAL",
      status: "PENDING",
      amountCents: body.amountCents,
      currency,
      referenceCode,
      merchantId,
      userId: user.id,
      detailsJson: { method: body.method, destination: body.destination, destinationId: destRecord.id, extras: body.extraFields || {} },
    },
  });

  await tgNotify(`🟡 WITHDRAWAL request\nRef: <b>${referenceCode}</b>\nAmount: ${body.amountCents} ${currency}`).catch(() => {});
  res.json({ ok: true, id: pr.id, referenceCode });
});

// ───────────────────────────────────────────────
// 5) Public: reusable deposit draft
checkoutPublicRouter.get("/public/deposit/draft", checkoutAuth, applyMerchantLimits, async (req: any, res) => {
  const { merchantId, diditSubject, currency } = req.checkout;
  const user = await prisma.user.findUnique({ where: { diditSubject } });
  if (!user) return res.json({ ok: true, draft: null });

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

  res.json({ ok: true, draft: pr || null });
});

// ───────────────────────────────────────────────
// 6) KYC: start + status (Didit low-code link)
checkoutPublicRouter.post("/public/kyc/start", checkoutAuth, applyMerchantLimits, async (req: any, res) => {
  const { diditSubject } = req.checkout;

  const user = await prisma.user.upsert({
    where: { diditSubject },
    create: { diditSubject, verifiedAt: null },
    update: {},
  });

  let url: string | null = null;
  try {
    const didit = await import("../services/didit.js");
    if (typeof didit.createLowCodeLink === "function") {
      const out = await didit.createLowCodeLink({ subject: diditSubject });
      url = out.url;
      await prisma.kycVerification.create({
        data: { userId: user.id, provider: "didit", status: "pending", externalSessionId: out.sessionId },
      });
    }
  } catch {}

  if (!url) url = "/fake-didit";
  res.json({ ok: true, url });
});

checkoutPublicRouter.get("/public/kyc/status", checkoutAuth, applyMerchantLimits, async (req: any, res) => {
  const { diditSubject } = req.checkout;
  const user = await prisma.user.findUnique({ where: { diditSubject } });
  if (!user) return res.json({ ok: true, status: "pending" });

  const last = await prisma.kycVerification.findFirst({
    where: { userId: user.id, provider: "didit" },
    orderBy: { createdAt: "desc" },
  });

  if (user.verifiedAt) return res.json({ ok: true, status: "approved" });

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