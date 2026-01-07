import type {
  ProviderAdapter,
  DepositIntentInput,
  DepositIntentResult,
} from "./Provider.js";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma.js";

/**
 * Dual mode:
 *  - SIM (default): no outbound calls, fully simulated (your current behavior)
 *  - REAL: calls Fazz v4-ID (sandbox) using FAZZ_API_* envs
 *
 * Minimal REAL coverage for MVP:
 *  - createDepositIntent (virtual_account - dynamic/static)
 *  - getDepositStatus
 * The rest (validate / disbursements) stay simulated for now.
 */

const MODE = (process.env.FAZZ_MODE || "SIM").toUpperCase();
const API_BASE = process.env.FAZZ_API_BASE || "";
const API_KEY  = process.env.FAZZ_API_KEY  || "";
const API_SECRET = process.env.FAZZ_API_SECRET || "";

const makeFakeId = (prefix: string) =>
  prefix + "_" + crypto.randomBytes(6).toString("hex");

// per-bank name length limits (tweak as needed; defaults to 40)
const BANK_NAME_LIMITS: Record<string, number> = {
  BCA: Number(process.env.FAZZ_BANK_NAME_LIMIT_BCA || 20),
  BNI: Number(process.env.FAZZ_BANK_NAME_LIMIT_BNI || 20),
  BRI: Number(process.env.FAZZ_BANK_NAME_LIMIT_BRI || 20),
  MANDIRI: Number(process.env.FAZZ_BANK_NAME_LIMIT_MANDIRI || 20),
};

const DEFAULT_NAME_LIMIT = Number(process.env.FAZZ_BANK_NAME_LIMIT_DEFAULT || 40);

function bankNameLimit(bankCode: string) {
  const code = (bankCode || "").toUpperCase();
  return BANK_NAME_LIMITS[code] ?? DEFAULT_NAME_LIMIT;
}

function normalizeNameForBank(name: string, bankCode: string) {
  const limit = bankNameLimit(bankCode);
  const raw = (name || "").trim();
  return raw.slice(0, limit);
}

/**
 * Deterministic static VA number (SIM mode only)
 */
function staticVaNumber(merchantId: string, uid: string, bankCode: string) {
  const h = crypto
    .createHash("sha1")
    .update(`${merchantId}|${uid}|${(bankCode || "").toUpperCase()}`)
    .digest("hex");
  const digits = h.replace(/[^\d]/g, "") + "0000000000";
  const tail = digits.slice(0, 10);
  return "988" + tail;
}

/** Dynamic VA number (SIM mode only) */
function dynamicVaNumber() {
  const now = Date.now().toString();
  const tail = now.slice(-10).padStart(10, "0");
  return "988" + tail;
}

/** ---- REAL helpers ---- **/
function hmacSha256Hex(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function fazzHeaders(body: string, idempotencyKey?: string) {
  // These header names vary across tenants/docs. We send both “X-API-KEY” and “X-Api-Key” to be safe,
  // along with a simple HMAC signature over the raw body. If your account expects different headers
  // (e.g., Authorization: Bearer), swap here.
  const sig = hmacSha256Hex(body, API_SECRET);
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-API-KEY": API_KEY,
    "X-Api-Key": API_KEY,
    "X-API-SIGNATURE": sig,
    "X-Api-Signature": sig,
  };
  if (idempotencyKey) {
    h["Idempotency-Key"] = idempotencyKey;
  }
  return h;
}

function ensureRealReady() {
  if (!API_BASE || !API_KEY || !API_SECRET) {
    throw new Error("FAZZ REAL mode requires FAZZ_API_BASE, FAZZ_API_KEY, FAZZ_API_SECRET");
  }
}

/** defensively pull nested fields */
function pick<T = any>(obj: any, paths: string[]): T | undefined {
  for (const p of paths) {
    const parts = p.split(".");
    let cur = obj;
    let ok = true;
    for (const k of parts) {
      if (cur && typeof cur === "object" && k in cur) cur = cur[k];
      else { ok = false; break; }
    }
    if (ok) return cur as T;
  }
  return undefined;
}

/** Try to extract VA & status from Fazz responses with leniency */
function parseFazzAcceptCreateResponse(json: any, fallbackName: string, bankCode: string) {
  const providerPaymentId =
    pick<string>(json, ["id", "data.id", "payment.id", "payment.data.id"]) ||
    makeFakeId("pay");

  const expiresAt =
    pick<string>(json, ["expiresAt", "data.expiresAt", "payment.expiresAt"]) ||
    undefined;

  const accountNo =
    pick<string>(json, [
      "va.account_no",
      "va.accountNo",
      "virtual_account.account_no",
      "virtual_account.accountNo",
      "data.va.account_no",
      "data.virtual_account.account_no",
    ]) || undefined;

  const accountName =
    pick<string>(json, [
      "va.account_name",
      "va.accountName",
      "virtual_account.account_name",
      "virtual_account.accountName",
      "data.va.account_name",
      "data.virtual_account.account_name",
    ]) || fallbackName;

  return {
    providerPaymentId,
    expiresAt,
    va: {
      bankCode,
      accountNo,
      accountName,
    },
    raw: json,
  };
}

async function realCreateDepositIntent(input: DepositIntentInput): Promise<DepositIntentResult> {
  ensureRealReady();

  const isDynamic = input.methodCode.toUpperCase().includes("DYNAMIC");
  const displayName = normalizeNameForBank(input.kyc.fullName, input.bankCode);

  // The exact schema differs per Fazz tenant; this is a safe, minimal payload
  // that many v4-ID setups accept for VA.
  const body = {
    method: "virtual_bank_account",
    type: isDynamic ? "DYNAMIC" : "STATIC",
    currency: input.currency,
    amount: input.amountCents, // cents
    referenceId: input.tid,    // keep your TID idempotency semantics
    bankCode: input.bankCode,  // sometimes named bank_short_code/bank_code
    customer: {
      name: displayName,
    },
    metadata: {
      uid: input.uid,
      merchantId: input.merchantId,
      methodCode: input.methodCode,
    },
  };

  const raw = JSON.stringify(body);
  const res = await fetch(`${API_BASE}/payments`, {
    method: "POST",
    headers: fazzHeaders(raw, input.tid),
    body: raw,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // surface provider error to caller/UI
    const msg = pick<string>(json, ["message", "error", "errors[0].message"]) || `HTTP ${res.status}`;
    throw new Error(`Fazz createDepositIntent failed: ${msg}`);
  }

  const parsed = parseFazzAcceptCreateResponse(json, displayName, input.bankCode);

  // Some sandboxes don’t immediately return VA number; if missing, keep fallback
  const accountNo = parsed.va.accountNo || dynamicVaNumber();

  return {
    providerPaymentId: parsed.providerPaymentId,
    expiresAt: parsed.expiresAt,
    instructions: {
      type: "virtual_account",
      method: isDynamic ? "DYNAMIC" : "STATIC",
      bankCode: input.bankCode,
      steps: [
        "Open your banking app.",
        `Transfer IDR ${(input.amountCents / 100).toFixed(2)} to the VA below.`,
        "Use immediate transfer if available.",
      ],
    },
    va: {
      bankCode: input.bankCode,
      accountNo,
      accountName: parsed.va.accountName || displayName,
    },
  };
}

async function realGetDepositStatus(providerPaymentId: string) {
  ensureRealReady();
  const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(providerPaymentId)}`, {
    method: "GET",
    headers: fazzHeaders("", undefined),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = pick<string>(json, ["message", "error", "errors[0].message"]) || `HTTP ${res.status}`;
    throw new Error(`Fazz getDepositStatus failed: ${msg}`);
  }
  const status =
    pick<string>(json, ["status", "data.status", "payment.status"]) ||
    "pending";
  return { status, raw: json };
}

export const fazzAdapter: ProviderAdapter = {
  async createDepositIntent(input: DepositIntentInput): Promise<DepositIntentResult> {
    if (MODE === "REAL") {
      return realCreateDepositIntent(input);
    }

    // ---- SIM mode (your existing behavior) ----
    const isDynamic = input.methodCode.toUpperCase().includes("DYNAMIC");
    const now = Date.now();
    const expiresMs = isDynamic ? 30 * 60_000 : 7 * 24 * 60 * 60_000; // 30 min vs 7 days

    const providerPaymentId = makeFakeId("pay");
    const vaNumber = isDynamic
      ? dynamicVaNumber()
      : staticVaNumber(input.merchantId, input.uid, input.bankCode);

    const accountName = normalizeNameForBank(input.kyc.fullName, input.bankCode);

    const instructions = {
      type: "virtual_account",
      method: isDynamic ? "DYNAMIC" : "STATIC",
      bankCode: input.bankCode,
      steps: [
        "Open your banking app.",
        `Transfer IDR ${(input.amountCents / 100).toFixed(2)} to the VA below.`,
        "Use immediate transfer if available.",
      ],
    };

    return {
      providerPaymentId,
      expiresAt: new Date(now + expiresMs).toISOString(),
      instructions,
      va: {
        bankCode: input.bankCode,
        accountNo: vaNumber,
        accountName,
      },
    };
  },

  async getDepositStatus(providerPaymentId: string) {
    // Prefer DB if present
    try {
      const pp = await prisma.providerPayment.findFirst({
        where: { providerPaymentId },
        select: { status: true, rawLatestJson: true },
      });
      if (pp && pp.status) {
        return {
          status: pp.status,
          raw: pp.rawLatestJson ?? { source: "db", providerPaymentId, status: pp.status },
        };
      }
    } catch {
      // ignore DB errors
    }

    if (MODE === "REAL") {
      return realGetDepositStatus(providerPaymentId);
    }

    // SIM fallback
    const h = crypto.createHash("sha256").update(providerPaymentId).digest("hex");
    const bucket = parseInt(h.slice(0, 2), 16) % 3;
    const status = bucket === 0 ? "pending" : bucket === 1 ? "paid" : "completed";
    return { status, raw: { simulated: true, providerPaymentId, status } };
  },

  async cancelDeposit() {
    // no-op in both modes for now
  },

  // keep validate as SIM for the moment (low risk)
  async validateBankAccount({ bankCode, accountNo }) {
    const holder = "VALIDATED HOLDER";
    return { ok: true, holder, raw: { simulated: true, bankCode, accountNo, holder } };
  },

  // keep disbursement as SIM for the moment (we’ll wire REAL after Accept is green)
  async createDisbursement({
    tid,
    amountCents,
    currency,
    bankCode,
    accountNo,
    holderName,
  }) {
    const providerPayoutId = makeFakeId("pout");
    return {
      providerPayoutId,
      raw: {
        simulated: true,
        tid,
        amountCents,
        currency,
        bankCode,
        accountNo,
        holderName,
      },
    };
  },

  async getDisbursementStatus(providerPayoutId: string) {
    // Prefer DB if present
    try {
      const pd = await prisma.providerDisbursement.findFirst({
        where: { providerPayoutId },
        select: { status: true, rawLatestJson: true },
      });
      if (pd && pd.status) {
        return {
          status: pd.status,
          raw: pd.rawLatestJson ?? { source: "db", providerPayoutId, status: pd.status },
        };
      }
    } catch {
      // ignore DB failures
    }

    // SIM
    const h = crypto.createHash("sha256").update(providerPayoutId).digest("hex");
    const bucket = parseInt(h.slice(0, 2), 16) % 3;
    const status = bucket === 0 ? "processing" : bucket === 1 ? "completed" : "failed";
    return { status, raw: { simulated: true, providerPayoutId, status } };
  },
};
