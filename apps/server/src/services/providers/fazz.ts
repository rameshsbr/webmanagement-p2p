import type {
  ProviderAdapter,
  DepositIntentInput,
  DepositIntentResult,
} from "./Provider.js";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma.js";

/**
 * Dual mode:
 *  - SIM (default): no outbound calls, fully simulated
 *  - REAL: calls Fazz v4-ID (sandbox) using FAZZ_API_* envs
 *
 * REAL mode (per docs):
 *  - Base URL (sandbox): https://sandbox-id.xfers.com/api/v4
 *  - Auth: HTTP Basic (base64(apiKey:apiSecret))
 *  - Create VA payment: POST /payments with payment_method_options.virtual_bank_account
 *  - Get status:        GET  /payments/{id}
 */
const MODE = (process.env.FAZZ_MODE || "SIM").toUpperCase();
const API_BASE = (process.env.FAZZ_API_BASE || "").replace(/\/+$/, "");
const API_KEY = process.env.FAZZ_API_KEY || "";
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

/** SIM: deterministic static VA */
function staticVaNumber(merchantId: string, uid: string, bankCode: string) {
  const h = crypto
    .createHash("sha1")
    .update(`${merchantId}|${uid}|${(bankCode || "").toUpperCase()}`)
    .digest("hex");
  const digits = h.replace(/[^\d]/g, "") + "0000000000";
  const tail = digits.slice(0, 10);
  return "988" + tail;
}

/** SIM: dynamic VA */
function dynamicVaNumber() {
  const now = Date.now().toString();
  const tail = now.slice(-10).padStart(10, "0");
  return "988" + tail;
}

/** ---- REAL helpers ---- **/
function ensureRealReady() {
  if (!API_BASE || !API_KEY || !API_SECRET) {
    throw new Error("FAZZ REAL mode requires FAZZ_API_BASE, FAZZ_API_KEY, FAZZ_API_SECRET");
  }
}

function basicAuthHeader() {
  const token = Buffer.from(`${API_KEY}:${API_SECRET}`).toString("base64");
  return `Basic ${token}`;
}

/** tiny safe picker */
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

/** Parse VA + expires + id from varied JSON shapes (covers snake/camel & nested paymentMethod) */
function parseFazzAcceptCreateResponse(json: any, fallbackName: string, bankCode: string) {
  const providerPaymentId =
    pick<string>(json, ["id", "data.id", "payment.id", "payment.data.id"]) || makeFakeId("pay");

  const expiresAt =
    pick<string>(json, ["expiresAt", "data.expiresAt", "payment.expiresAt"]) || undefined;

  const accountNo =
    pick<string>(json, [
      // direct VA shapes
      "va.account_no",
      "va.accountNo",
      "virtual_account.account_no",
      "virtual_account.accountNo",
      "data.va.account_no",
      "data.virtual_account.account_no",
      // nested paymentMethod shapes (per docs)
      "paymentMethod.virtual_bank_account.account_no",
      "paymentMethod.virtualBankAccount.accountNo",
      "data.paymentMethod.virtual_bank_account.account_no",
    ]) || undefined;

  const accountName =
    pick<string>(json, [
      "va.account_name",
      "va.accountName",
      "virtual_account.account_name",
      "virtual_account.accountName",
      "data.va.account_name",
      "data.virtual_account.account_name",
      "paymentMethod.virtual_bank_account.account_name",
      "paymentMethod.virtualBankAccount.accountName",
    ]) || fallbackName;

  const paymentMethodId =
    pick<string>(json, ["paymentMethod.id", "data.paymentMethod.id"]);

  return {
    providerPaymentId,
    expiresAt,
    va: { bankCode, accountNo, accountName },
    paymentMethodId,
    raw: json,
  };
}

/** ---- REAL calls (per docs) ----
 * Create VA payment: POST /payments
 * Body must include payment_method_options.virtual_bank_account with bank_short_code/display_name
 * Amount for IDR is whole rupiah (send amountCents/100).
 */
async function realCreateDepositIntent(input: DepositIntentInput): Promise<DepositIntentResult> {
  ensureRealReady();

  const isDynamic = input.methodCode.toUpperCase().includes("DYNAMIC");
  const displayName = normalizeNameForBank(input.kyc.fullName, input.bankCode);
  const amountIdr = Math.round(input.amountCents / 100); // IDR has 0 decimals in most APIs

  // send both snake_case and camelCase to be tenant-tolerant
  const body: any = {
    amount: amountIdr,
    currency: input.currency,
    reference_id: input.tid,
    referenceId: input.tid,

    payment_method_options: {
      virtual_bank_account: {
        bank_short_code: input.bankCode,
        display_name: displayName,
        mode: isDynamic ? "DYNAMIC" : "STATIC",
      },
    },
    paymentMethodOptions: {
      virtualBankAccount: {
        bankShortCode: input.bankCode,
        displayName,
        mode: isDynamic ? "DYNAMIC" : "STATIC",
      },
    },

    metadata: {
      uid: input.uid,
      merchantId: input.merchantId,
      methodCode: input.methodCode,
    },
  };

  const url = `${API_BASE}/payments`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": basicAuthHeader(),
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Idempotency-Key": input.tid,
    },
    body: JSON.stringify(body),
  });

  let json: any = null;
  let text = "";
  try { json = await res.clone().json(); } catch { text = await res.text(); }

  if (!res.ok) {
    console.error("[FAZZ_ACCEPT_FAILED] POST /payments", {
      status: res.status,
      body: json ?? text,
      url,
    });
    const msg =
      pick<string>(json, ["message", "error", "errors[0].message"]) ||
      (text || `HTTP ${res.status}`);
    throw new Error(`Fazz createDepositIntent failed: ${msg}`);
  }

  const parsed = parseFazzAcceptCreateResponse(json ?? {}, displayName, input.bankCode);
  const accountNo = parsed.va.accountNo || dynamicVaNumber(); // some sandboxes emit VA later

  if (json && parsed.paymentMethodId && typeof json === "object") {
    json.__paymentMethodId = parsed.paymentMethodId;
  }

  return {
    providerPaymentId: parsed.providerPaymentId,
    expiresAt: parsed.expiresAt,
    instructions: {
      type: "virtual_account",
      method: isDynamic ? "DYNAMIC" : "STATIC",
      bankCode: input.bankCode,
      steps: [
        "Open your banking app.",
        `Transfer IDR ${amountIdr.toLocaleString("en-AU")} to the VA below.`,
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
  const url = `${API_BASE}/payments/${encodeURIComponent(providerPaymentId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": basicAuthHeader(),
      "Accept": "application/json",
    },
  });
  let json: any = null, text = "";
  try { json = await res.clone().json(); } catch { text = await res.text(); }
  if (!res.ok) {
    console.error("[FAZZ_STATUS_FAILED] GET /payments/:id", {
      status: res.status,
      body: json ?? text,
      url,
    });
    const msg =
      pick<string>(json, ["message", "error", "errors[0].message"]) ||
      (text || `HTTP ${res.status}`);
    throw new Error(`Fazz getDepositStatus failed: ${msg}`);
  }
  const status =
    pick<string>(json, ["status", "data.status", "payment.status"]) || "pending";
  return { status, raw: json ?? text };
}

/** ---- Public adapter ---- */
export const fazzAdapter: ProviderAdapter = {
  async createDepositIntent(input: DepositIntentInput): Promise<DepositIntentResult> {
    if (MODE === "REAL") {
      return realCreateDepositIntent(input);
    }

    // ---- SIM mode (unchanged) ----
    const isDynamic = input.methodCode.toUpperCase().includes("DYNAMIC");
    const now = Date.now();
    const expiresMs = isDynamic ? 30 * 60_000 : 7 * 24 * 60 * 60_000;

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
        `Transfer IDR ${(input.amountCents / 100).toFixed(0)} to the VA below.`,
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

  // keep validate as SIM for the moment
  async validateBankAccount({ bankCode, accountNo }) {
    const holder = "VALIDATED HOLDER";
    return { ok: true, holder, raw: { simulated: true, bankCode, accountNo, holder } };
  },

  // keep disbursement as SIM for the moment
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
