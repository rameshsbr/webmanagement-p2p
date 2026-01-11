// apps/server/src/services/providers/fazz.ts
import type {
  ProviderAdapter,
  DepositIntentInput,
  DepositIntentResult,
} from "./Provider";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma.js";

/**
 * MODE:
 *  - SIM  (default): no outbound calls; predictable data
 *  - REAL: call Fazz v4-ID JSON:API with FAZZ_API_* envs
 */
const MODE = (process.env.FAZZ_MODE || "SIM").toUpperCase();
const API_BASE = (process.env.FAZZ_API_BASE || "").replace(/\/+$/, "");
const API_KEY = process.env.FAZZ_API_KEY || "";
const API_SECRET = process.env.FAZZ_API_SECRET || "";

/* ---------------- shared helpers ---------------- */

const makeFakeId = (prefix: string) =>
  prefix + "_" + crypto.randomBytes(6).toString("hex");

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

const ZERO_DECIMAL = new Set(["IDR", "JPY", "KRW"]);
function minorUnit(currency: string) {
  return ZERO_DECIMAL.has((currency || "").toUpperCase()) ? 1 : 100;
}
function formatAmountForDisplay(amountCents: number, currency: string) {
  const mu = minorUnit(currency);
  const major = amountCents / mu;
  if ((currency || "").toUpperCase() === "IDR") {
    return `IDR ${major.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return `${(currency || "").toUpperCase()} ${major.toLocaleString("en-US", {
    minimumFractionDigits: mu === 1 ? 0 : 2,
    maximumFractionDigits: mu === 1 ? 0 : 2,
  })}`;
}

function staticVaNumber(merchantId: string, uid: string, bankCode: string) {
  const h = crypto
    .createHash("sha1")
    .update(`${merchantId}|${uid}|${(bankCode || "").toUpperCase()}`)
    .digest("hex");
  const digits = h.replace(/[^\d]/g, "") + "0000000000";
  const tail = digits.slice(0, 10);
  return "988" + tail;
}
function dynamicVaNumber() {
  const now = Date.now().toString();
  const tail = now.slice(-10).padStart(10, "0");
  return "988" + tail;
}

/* ---------------- REAL helpers ---------------- */

function ensureRealReady() {
  if (!API_BASE || !API_KEY || !API_SECRET) {
    throw new Error("FAZZ REAL mode requires FAZZ_API_BASE, FAZZ_API_KEY, FAZZ_API_SECRET");
  }
}
function basicAuthHeader() {
  const token = Buffer.from(`${API_KEY}:${API_SECRET}`).toString("base64");
  return `Basic ${token}`;
}
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
function findIncludedId(json: any): string | undefined {
  const arr = json?.included;
  if (!Array.isArray(arr)) return undefined;
  const candTypes = new Set([
    "payment_method", "payment_methods", "PaymentMethod", "paymentMethod",
  ]);
  for (const it of arr) {
    if (it && typeof it === "object" && typeof it.id === "string" && candTypes.has(String(it.type || ""))) {
      return String(it.id);
    }
  }
  return undefined;
}
function extractErrMessage(status: number, json: any, text: string) {
  const d =
    pick<string>(json, ["errors[0].detail"]) ||
    pick<string>(json, ["errors[0].title"]) ||
    pick<string>(json, ["message"]) ||
    pick<string>(json, ["error"]) ||
    text ||
    "";
  return `HTTP ${status}${d ? ` - ${d}` : ""}`;
}
function parseCreateResp(json: any, fallbackName: string, bankCode: string) {
  const providerPaymentId =
    pick<string>(json, ["data.id"]) ||
    pick<string>(json, ["id"]) ||
    makeFakeId("pay");

  const expiresAt =
    pick<string>(json, [
      "data.attributes.expiresAt",
      "expiresAt",
      "data.expiresAt",
      "payment.expiresAt",
    ]) || undefined;

  const accountNo =
    pick<string>(json, [
      "data.attributes.paymentMethod.virtual_bank_account.account_no",
      "data.attributes.payment_method.virtual_bank_account.account_no",
      "va.account_no",
      "virtual_account.account_no",
      "data.va.account_no",
      "data.virtual_account.account_no",
      "paymentMethod.virtual_bank_account.account_no",
      "data.paymentMethod.virtual_bank_account.account_no",
    ]) || undefined;

  const accountName =
    pick<string>(json, [
      "data.attributes.paymentMethod.virtual_bank_account.account_name",
      "data.attributes.payment_method.virtual_bank_account.account_name",
      "va.account_name",
      "virtual_account.account_name",
      "data.va.account_name",
      "data.virtual_account.account_name",
      "paymentMethod.virtual_bank_account.account_name",
      "data.paymentMethod.virtual_bank_account.account_name",
    ]) || fallbackName;

  let paymentMethodId =
    pick<string>(json, [
      "data.relationships.paymentMethod.data.id",
      "data.relationships.payment_method.data.id",
      "data.relationships.paymentMethods.data.0.id",
      "data.relationships.payment_methods.data.0.id",
      "data.attributes.paymentMethod.id",
      "data.attributes.payment_method.id",
    ]) || findIncludedId(json);

  return {
    providerPaymentId: String(providerPaymentId),
    expiresAt,
    va: { bankCode, accountNo, accountName },
    paymentMethodId: paymentMethodId ? String(paymentMethodId) : undefined,
    raw: json,
  };
}
async function fetchPaymentDetails(paymentId: string) {
  const url = `${API_BASE}/payments/${encodeURIComponent(paymentId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: basicAuthHeader(), Accept: "application/vnd.api+json" },
  });
  let json: any = null, text = "";
  try { json = await res.clone().json(); } catch { text = await res.text(); }
  if (!res.ok) {
    console.error("[FAZZ_STATUS_FAILED] GET /payments/:id", JSON.stringify({ status: res.status, url, body: json ?? text }, null, 2));
    return null;
  }
  let paymentMethodId =
    pick<string>(json, [
      "data.relationships.paymentMethod.data.id",
      "data.relationships.payment_method.data.id",
      "data.relationships.paymentMethods.data.0.id",
      "data.relationships.payment_methods.data.0.id",
      "data.attributes.paymentMethod.id",
      "data.attributes.payment_method.id",
    ]) || findIncludedId(json);
  const parsed = parseCreateResp(json, "", "");
  return {
    json,
    paymentMethodId: paymentMethodId ? String(paymentMethodId) : parsed.paymentMethodId,
    va: parsed.va,
  };
}
async function fetchPaymentMethodsForPayment(paymentId: string) {
  const url = `${API_BASE}/payment_methods?paymentId=${encodeURIComponent(paymentId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: basicAuthHeader(), Accept: "application/vnd.api+json" },
  });
  let json: any = null, text = "";
  try { json = await res.clone().json(); } catch { text = await res.text(); }
  if (!res.ok) {
    console.error("[FAZZ_PM_LIST_FAILED] GET /payment_methods?paymentId", JSON.stringify({ status: res.status, url, body: json ?? text }, null, 2));
    return { id: undefined, raw: json ?? text };
  }
  const firstId = pick<string>(json, ["data.0.id"]) || pick<string>(json, ["data[0].id"]);
  return { id: firstId, raw: json ?? text };
}

/* ---------------- REAL calls ---------------- */

async function realCreateDepositIntent(input: DepositIntentInput): Promise<DepositIntentResult> {
  ensureRealReady();

  const isDynamic = input.methodCode.toUpperCase().includes("DYNAMIC");
  const displayName = normalizeNameForBank(input.kyc.fullName, input.bankCode);

  const payload = {
    data: {
      type: "payments",
      attributes: {
        amount: input.amountCents,
        currency: input.currency,
        referenceId: input.tid,
        paymentMethodType: "virtual_bank_account",
        paymentMethodOptions: {
          bankShortCode: input.bankCode,
          displayName,
          mode: isDynamic ? "DYNAMIC" : "STATIC",
        },
        metadata: {
          uid: input.uid,
          merchantId: input.merchantId,
          methodCode: input.methodCode,
        },
      },
    },
  };

  const url = `${API_BASE}/payments`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
      "Idempotency-Key": input.tid,
    },
    body: JSON.stringify(payload),
  });

  let json: any = null;
  let text = "";
  try { json = await res.clone().json(); } catch { text = await res.text(); }

  if (!res.ok) {
    console.error("[FAZZ_ACCEPT_FAILED] POST /payments", JSON.stringify({
      status: res.status, url, body: json ?? text, sent: payload.data.attributes,
    }, null, 2));
    const msg = extractErrMessage(res.status, json, text);
    throw new Error(`Fazz createDepositIntent failed: ${msg}`);
  }

  const parsed = parseCreateResp(json ?? {}, displayName, input.bankCode);

  // Backfill PM id + VA if missing
  let paymentMethodId = parsed.paymentMethodId;
  let vaAccountNo = parsed.va.accountNo;
  let vaAccountName = parsed.va.accountName;

  if (!paymentMethodId || !vaAccountNo) {
    const details = await fetchPaymentDetails(parsed.providerPaymentId);
    if (details) {
      paymentMethodId = paymentMethodId || details.paymentMethodId || undefined;
      vaAccountNo = vaAccountNo || details.va.accountNo || undefined;
      vaAccountName = vaAccountName || details.va.accountName || displayName;
      if (json && typeof json === "object") {
        (json as any).__fetchedPayment = details.json;
      }
    }
  }
  if (!paymentMethodId) {
    const { id: fromList, raw } = await fetchPaymentMethodsForPayment(parsed.providerPaymentId);
    if (fromList) paymentMethodId = fromList;
    if (json && typeof json === "object") {
      (json as any).__fetchedPaymentMethods = raw;
    }
  }

  const accountNo = vaAccountNo || dynamicVaNumber();

  const meta: any = {};
  if (paymentMethodId) meta.paymentMethodId = paymentMethodId;
  const fetched: any = {};
  if (json && (json as any).__fetchedPayment) fetched.payment = (json as any).__fetchedPayment;
  if (json && (json as any).__fetchedPaymentMethods) fetched.paymentMethods = (json as any).__fetchedPaymentMethods;
  if (Object.keys(fetched).length) meta.fetched = fetched;
  if (json && paymentMethodId && typeof json === "object") {
    (json as any).__paymentMethodId = paymentMethodId;
  }

  return {
    providerPaymentId: String(parsed.providerPaymentId),
    expiresAt: parsed.expiresAt,
    instructions: {
      type: "virtual_account",
      method: isDynamic ? "DYNAMIC" : "STATIC",
      bankCode: input.bankCode,
      steps: [
        "Open your banking app.",
        `Transfer ${formatAmountForDisplay(input.amountCents, input.currency)} to the VA below.`,
        "Use immediate transfer if available.",
      ],
      meta,
    },
    va: {
      bankCode: input.bankCode,
      accountNo,
      accountName: vaAccountName || displayName,
      meta,
    },
  };
}

async function realGetDepositStatus(providerPaymentId: string) {
  ensureRealReady();
  const url = `${API_BASE}/payments/${encodeURIComponent(providerPaymentId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: basicAuthHeader(), Accept: "application/vnd.api+json" },
  });
  let json: any = null, text = "";
  try { json = await res.clone().json(); } catch { text = await res.text(); }
  if (!res.ok) {
    console.error("[FAZZ_STATUS_FAILED] GET /payments/:id", JSON.stringify({ status: res.status, url, body: json ?? text }, null, 2));
    const msg = extractErrMessage(res.status, json, text);
    throw new Error(`Fazz getDepositStatus failed: ${msg}`);
  }
  const status =
    pick<string>(json, [
      "data.attributes.status",
      "status",
      "data.status",
      "payment.status",
    ]) || "pending";

  try {
    await prisma.providerPayment.updateMany({
      where: { providerPaymentId },
      data: { status, rawLatestJson: json ?? text, updatedAt: new Date() },
    });
  } catch {}

  return { status, raw: json ?? text };
}

async function realValidateBankAccount(input: { bankCode: string; accountNo: string; name?: string }) {
  ensureRealReady();

  // Attempt A: /bank_accounts/validate
  const aUrl = `${API_BASE}/bank_accounts/validate`;
  const aPayload = {
    data: {
      type: "bank_accounts",
      attributes: {
        bankShortCode: input.bankCode,
        accountNo: input.accountNo,
        name: input.name || undefined,
      },
    },
  };
  let res = await fetch(aUrl, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
    },
    body: JSON.stringify(aPayload),
  });
  let json: any = null, text = "";
  try { json = await res.clone().json(); } catch { text = await res.text(); }
  if (res.ok) {
    const holder =
      pick<string>(json, [
        "data.attributes.holderName",
        "data.attributes.accountName",
        "holderName",
        "accountName",
      ]);
    return { ok: Boolean(holder), holder, raw: json ?? text };
  }

  // Attempt B: alternate path (some accounts expose different route)
  const bUrl = `${API_BASE}/bank_accounts/validations`;
  const bPayload = {
    data: {
      type: "bank_account_validations",
      attributes: {
        bankShortCode: input.bankCode,
        accountNo: input.accountNo,
        name: input.name || undefined,
      },
    },
  };
  res = await fetch(bUrl, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
    },
    body: JSON.stringify(bPayload),
  });
  json = null; text = "";
  try { json = await res.clone().json(); } catch { text = await res.text(); }
  if (!res.ok) {
    const msg = extractErrMessage(res.status, json, text);
    console.error("[FAZZ_VALIDATE_FAILED]", msg, { aUrl, bUrl, aBody: aPayload, bBody: bPayload });
    return { ok: false, holder: undefined, raw: json ?? text };
  }
  const holder =
    pick<string>(json, [
      "data.attributes.holderName",
      "data.attributes.accountName",
      "holderName",
      "accountName",
    ]);
  return { ok: Boolean(holder), holder, raw: json ?? text };
}

type CreateDisbInput = {
  tid: string;
  merchantId: string;
  uid: string;
  amountCents: number;
  currency: string;
  bankCode: string;
  accountNo: string;
  holderName: string;
};

async function tryCreateDisbursementVia(path: string, payload: any, idemKey: string) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
      "Idempotency-Key": idemKey,
    },
    body: JSON.stringify(payload),
  });
  let json: any = null, text = "";
  try { json = await res.clone().json(); } catch { text = await res.text(); }
  return { ok: res.ok, status: res.status, json, text, url };
}

async function realCreateDisbursement(input: CreateDisbInput) {
  ensureRealReady();

  // Attempt A: official disbursements shape
  const aPayload = {
    data: {
      type: "disbursements",
      attributes: {
        amount: input.amountCents,
        currency: input.currency,
        referenceId: input.tid,
        destination: {
          type: "bank_transfer",
          bankShortCode: input.bankCode,
          // some tenants accept bankCode, send both to be safe
          bankCode: input.bankCode,
          accountNo: input.accountNo,
          accountHolderName: input.holderName,
        },
        metadata: {
          uid: input.uid,
          merchantId: input.merchantId,
        },
      },
    },
  };

  const a = await tryCreateDisbursementVia("/disbursements", aPayload, input.tid);
  if (a.ok) {
    const providerPayoutId =
      pick<string>(a.json, ["data.id"]) ||
      pick<string>(a.json, ["id"]) ||
      makeFakeId("pout");
    return { providerPayoutId: String(providerPayoutId), raw: a.json ?? a.text };
  }

  // If not allowed / bad path → Attempt B: payouts fallback
  const bPayload = {
    data: {
      type: "payouts",
      attributes: {
        amount: input.amountCents,
        currency: input.currency,
        referenceId: input.tid,
        payoutMethod: "bank_transfer",
        bankShortCode: input.bankCode,
        bankCode: input.bankCode,
        accountNumber: input.accountNo,
        accountHolderName: input.holderName,
        metadata: {
          uid: input.uid,
          merchantId: input.merchantId,
        },
      },
    },
  };
  const b = await tryCreateDisbursementVia("/payouts", bPayload, input.tid);
  if (b.ok) {
    const providerPayoutId =
      pick<string>(b.json, ["data.id"]) ||
      pick<string>(b.json, ["id"]) ||
      makeFakeId("pout");
    return { providerPayoutId: String(providerPayoutId), raw: b.json ?? b.text };
  }

  // Both failed → throw with provider body (so your API returns the real reason)
  const msgA = extractErrMessage(a.status, a.json, a.text);
  const msgB = extractErrMessage(b.status, b.json, b.text);
  console.error("[FAZZ_PAYOUT_FAILED]", {
    attemptA: { url: a.url, payload: aPayload, status: a.status, body: a.json ?? a.text },
    attemptB: { url: b.url, payload: bPayload, status: b.status, body: b.json ?? b.text },
  });
  throw new Error(`Fazz createDisbursement failed: ${msgA}; fallback: ${msgB}`);
}

async function realGetDisbursementStatus(providerPayoutId: string) {
  ensureRealReady();
  // Attempt A: /disbursements/:id
  const aUrl = `${API_BASE}/disbursements/${encodeURIComponent(providerPayoutId)}`;
  let res = await fetch(aUrl, {
    method: "GET",
    headers: { Authorization: basicAuthHeader(), Accept: "application/vnd.api+json" },
  });
  let json: any = null, text = "";
  try { json = await res.clone().json(); } catch { text = await res.text(); }
  if (res.ok) {
    const status =
      pick<string>(json, [
        "data.attributes.status",
        "status",
        "data.status",
        "disbursement.status",
      ]) || "processing";
    try {
      await prisma.providerDisbursement.updateMany({
        where: { providerPayoutId },
        data: { status, rawLatestJson: json ?? text, updatedAt: new Date() },
      });
    } catch {}
    return { status, raw: json ?? text };
  }

  // Attempt B: /payouts/:id
  const bUrl = `${API_BASE}/payouts/${encodeURIComponent(providerPayoutId)}`;
  res = await fetch(bUrl, {
    method: "GET",
    headers: { Authorization: basicAuthHeader(), Accept: "application/vnd.api+json" },
  });
  json = null; text = "";
  try { json = await res.clone().json(); } catch { text = await res.text(); }
  if (!res.ok) {
    const msg = extractErrMessage(res.status, json, text);
    console.error("[FAZZ_PAYOUT_STATUS_FAILED]", { aUrl, bUrl, aBody: json ?? text });
    throw new Error(`Fazz getDisbursementStatus failed: ${msg}`);
  }
  const status =
    pick<string>(json, [
      "data.attributes.status",
      "status",
      "data.status",
      "payout.status",
    ]) || "processing";
  try {
    await prisma.providerDisbursement.updateMany({
      where: { providerPayoutId },
      data: { status, rawLatestJson: json ?? text, updatedAt: new Date() },
    });
  } catch {}
  return { status, raw: json ?? text };
}

/* ---------------- public adapter ---------------- */

export const fazzAdapter: ProviderAdapter = {
  async createDepositIntent(input: DepositIntentInput): Promise<DepositIntentResult> {
    if (MODE === "REAL") {
      return realCreateDepositIntent(input);
    }

    // SIM mode
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
        `Transfer ${formatAmountForDisplay(input.amountCents, input.currency)} to the VA below.`,
        "Use immediate transfer if available.",
      ],
    };

    return {
      providerPaymentId,
      expiresAt: new Date(now + expiresMs).toISOString(),
      instructions,
      va: { bankCode: input.bankCode, accountNo: vaNumber, accountName },
    };
  },

  async getDepositStatus(providerPaymentId: string) {
    if (MODE === "REAL") return realGetDepositStatus(providerPaymentId);

    try {
      const pp = await prisma.providerPayment.findFirst({
        where: { providerPaymentId },
        select: { status: true, rawLatestJson: true },
      });
      if (pp && pp.status) {
        return { status: pp.status, raw: pp.rawLatestJson ?? { source: "db", providerPaymentId, status: pp.status } };
      }
    } catch {}
    const h = crypto.createHash("sha256").update(providerPaymentId).digest("hex");
    const bucket = parseInt(h.slice(0, 2), 16) % 3;
    const status = bucket === 0 ? "pending" : bucket === 1 ? "paid" : "completed";
    return { status, raw: { simulated: true, providerPaymentId, status } };
  },

  async cancelDeposit(_providerPaymentId?: string) {},

  async validateBankAccount(input: { bankCode: string; accountNo: string; name?: string }) {
    if (MODE === "REAL") return realValidateBankAccount(input);
    const holder = "VALIDATED HOLDER";
    return { ok: true, holder, raw: { simulated: true, bankCode: input.bankCode, accountNo: input.accountNo, holder } };
  },

  async createDisbursement(input: CreateDisbInput) {
    if (MODE === "REAL") return realCreateDisbursement(input);
    const providerPayoutId = makeFakeId("pout");
    return { providerPayoutId, raw: { simulated: true, ...input } };
  },

  async getDisbursementStatus(providerPayoutId: string) {
    if (MODE === "REAL") return realGetDisbursementStatus(providerPayoutId);

    try {
      const pd = await prisma.providerDisbursement.findFirst({
        where: { providerPayoutId },
        select: { status: true, rawLatestJson: true },
      });
      if (pd && pd.status) {
        return { status: pd.status, raw: pd.rawLatestJson ?? { source: "db", providerPayoutId, status: pd.status } };
      }
    } catch {}
    const h = crypto.createHash("sha256").update(providerPayoutId).digest("hex");
    const bucket = parseInt(h.slice(0, 2), 16) % 3;
    const status = bucket === 0 ? "processing" : bucket === 1 ? "completed" : "failed";
    return { status, raw: { simulated: true, providerPayoutId, status } };
  },
};