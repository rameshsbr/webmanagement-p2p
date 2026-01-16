// apps/server/src/services/providers/fazz.ts
import type {
  ProviderAdapter,
  DepositIntentInput,
  DepositIntentResult,
} from "./Provider";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { normalizeIdrV4BankCode } from "./fazz/idr-v4-banks.js";

/**
 * MODE:
 *  - SIM  (default): no outbound calls; predictable data
 *  - REAL: call Fazz v4-ID JSON:API with FAZZ_API_* envs
 *
 * JSON:API quick notes:
 *  - Base (sandbox): e.g. https://sandbox-id.xfers.com/api/v4
 *  - Basic auth: base64(apiKey:apiSecret)
 *  - Accept VA:
 *      POST /payments
 *      GET  /payments/:id
 *  - Send payouts (v4-ID):
 *      POST /disbursements
 *      GET  /disbursements/:id
 *  - Account validation (v4-ID):
 *      POST /validation_services/bank_account_validation
 */
const MODE = (process.env.FAZZ_MODE || "SIM").toUpperCase();
const API_BASE = (process.env.FAZZ_API_BASE || "").replace(/\/+$/, "");
const API_KEY = process.env.FAZZ_API_KEY || "";
const API_SECRET = process.env.FAZZ_API_SECRET || "";

// Prefer DISBURSEMENTS; keep AUTO fallback logic but target the same shape
const SEND_PREFERENCE = (process.env.FAZZ_SEND_PREFERENCE || "AUTO").toUpperCase();

const DEBUG = (process.env.FAZZ_DEBUG || "").toLowerCase() === "1";
// retry/backoff knobs
const RETRIES = Number(process.env.FAZZ_RETRIES ?? 1);
const RETRY_DELAY_MS = Number(process.env.FAZZ_RETRY_DELAY_MS ?? 300);

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
function suffixNoFromTid(tid: string) {
  const digits = String(tid || "").replace(/\D/g, "");
  return digits.slice(-8).padStart(8, "0");
}

/** Format a Date as an ISO-8601 string with an explicit offset like `+07:00` */
function toOffsetISOString(d: Date, offsetMinutes: number) {
  // Show the *same instant* in the requested local wall time, then append the offset.
  const shifted = new Date(d.getTime() + offsetMinutes * 60_000);
  const isoNoZ = shifted.toISOString().replace(/Z$/, ""); // 2026-01-16T12:34:56.789
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
  const mm = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  return `${isoNoZ}${sign}${hh}:${mm}`; // 2026-01-16T12:34:56.789+07:00
}

/** Jakarta = UTC+07:00. Use 65 minutes to be safely > 1 hour boundary. */
function jakartaFutureIso(minutesAhead = 65) {
  const d = new Date(Date.now() + minutesAhead * 60_000);
  return toOffsetISOString(d, 7 * 60);
}

const ZERO_DECIMAL = new Set(["IDR", "JPY", "KRW"]);
function minorUnit(currency: string) {
  return ZERO_DECIMAL.has((currency || "").toUpperCase()) ? 1 : 100;
}
function toProviderAmount(amountCents: number, currency: string) {
  const mu = minorUnit(currency);
  const major = amountCents / mu;
  return mu === 1 ? `${major.toFixed(1)}` : `${major.toFixed(2)}`;
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

/* ─── Platform status mapping (ADDED) ───────────────────────────────────────── */

export type PlatformPaymentStatus = "PENDING" | "APPROVED" | "REJECTED";

export function mapFazzPaymentStatusToPlatform(s: string): PlatformPaymentStatus {
  const v = String(s || "").toLowerCase();
  if (v === "completed") return "APPROVED";
  if (v === "failed" || v === "cancelled") return "REJECTED";
  // paid, pending, processing, anything else → PENDING
  return "PENDING";
}

export function mapFazzDisbursementStatusToPlatform(s: string): PlatformPaymentStatus {
  const v = String(s || "").toLowerCase();
  if (v === "completed") return "APPROVED";
  if (v === "failed" || v === "cancelled" || v === "rejected") return "REJECTED";
  // processing, pending, queued, etc. → PENDING
  return "PENDING";
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
function parseCreateResp(json: any, fallbackName: string, bankCode: string) {
  const providerPaymentId =
    pick<string>(json, ["data.id"]) ||
    pick<string>(json, ["id"]) ||
    makeFakeId("pay");

  // Accept both "expiresAt" and "expiredAt" (Fazz returns "expiredAt")
  const expiresAt =
    pick<string>(json, [
      "data.attributes.expiresAt",
      "expiresAt",
      "data.expiresAt",
      "payment.expiresAt",
      "data.attributes.expiredAt",
      "expiredAt",
      "data.expiredAt",
      "payment.expiredAt",
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
      "data.attributes.payment_method.instructions.account_no",
      "data.attributes.paymentMethod.instructions.account_no",
      // CamelCase fallbacks often returned by Fazz:
      "data.attributes.paymentMethod.instructions.accountNo",
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
      "data.attributes.payment_method.instructions.display_name",
      "data.attributes.paymentMethod.instructions.display_name",
      // CamelCase fallback:
      "data.attributes.paymentMethod.instructions.displayName",
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
function parsePaymentMethodResp(json: any, fallbackName: string, bankCode: string) {
  const providerPaymentMethodId =
    pick<string>(json, ["data.id"]) ||
    pick<string>(json, ["id"]) ||
    makeFakeId("pm");

  const accountNo =
    pick<string>(json, [
      "data.attributes.virtual_bank_account.account_no",
      "data.attributes.virtualBankAccount.accountNo",
      "data.attributes.instructions.accountNo",
      "data.attributes.instructions.account_no",
    ]) || undefined;

  const accountName =
    pick<string>(json, [
      "data.attributes.virtual_bank_account.account_name",
      "data.attributes.virtualBankAccount.accountName",
      "data.attributes.instructions.displayName",
      "data.attributes.instructions.display_name",
    ]) || fallbackName;

  return {
    providerPaymentMethodId: String(providerPaymentMethodId),
    va: { bankCode, accountNo, accountName },
    raw: json,
  };
}
async function fetchPaymentDetails(paymentId: string) {
  const url = `${API_BASE}/payments/${encodeURIComponent(paymentId)}`;
  const res = await fetchWithRetry(() =>
    fetch(url, {
      method: "GET",
      headers: { Authorization: basicAuthHeader(), Accept: "application/vnd.api+json" },
    })
  );
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
async function fetchPaymentMethodDetails(paymentMethodId: string) {
  const url = `${API_BASE}/payment_methods/${encodeURIComponent(paymentMethodId)}`;
  const res = await fetchWithRetry(() =>
    fetch(url, {
      method: "GET",
      headers: { Authorization: basicAuthHeader(), Accept: "application/vnd.api+json" },
    })
  );
  let json: any = null, text = "";
  try { json = await res.clone().json(); } catch { text = await res.text(); }
  if (!res.ok) {
    console.error("[FAZZ_PM_GET_FAILED] GET /payment_methods/:id", JSON.stringify({ status: res.status, url, body: json ?? text }, null, 2));
    return null;
  }
  const parsed = parsePaymentMethodResp(json, "", "");
  return { json, va: parsed.va };
}
async function fetchPaymentMethodsForPayment(paymentId: string) {
  const url = `${API_BASE}/payment_methods?paymentId=${encodeURIComponent(paymentId)}`;
  const res = await fetchWithRetry(() =>
    fetch(url, {
      method: "GET",
      headers: { Authorization: basicAuthHeader(), Accept: "application/vnd.api+json" },
    })
  );
  let json: any = null, text = "";
  try { json = await res.clone().json(); } catch { text = await res.text(); }
  if (!res.ok) {
    console.error("[FAZZ_PM_LIST_FAILED] GET /payment_methods?paymentId", JSON.stringify({ status: res.status, url, body: json ?? text }, null, 2));
    return { id: undefined, raw: json ?? text };
  }
  const firstId = pick<string>(json, ["data.0.id"]) || pick<string>(json, ["data[0].id"]);
  return { id: firstId, raw: json ?? text };
}

/* ---------------- REAL: low-level HTTP + retry ---------------- */

type FazzResp = { ok: boolean; status: number; json?: any; text?: string; url: string };

function isPathMissingOrForbidden(resp: FazzResp) {
  if (resp.ok) return false;
  const s = resp.status;
  if (s === 404 || s === 403) return true;
  const text = (resp.text || "").toLowerCase();
  const detail =
    (resp.json?.errors?.[0]?.detail || "").toString().toLowerCase() ||
    (resp.json?.title || "").toString().toLowerCase();
  return /page not exist|permission denied|not found/i.test(text) ||
         /page not exist|permission denied|not found/i.test(detail);
}

function renderProviderError(res: FazzResp, fallback = ""): string {
  const errs = Array.isArray(res.json?.errors) ? res.json.errors : [];
  const parts: string[] = [];
  for (const e of errs) {
    const seg = [e.code, e.title, e.detail].filter(Boolean).join(" - ");
    if (seg) parts.push(seg);
  }
  const joined = parts.join("; ");
  return joined || res.json?.message || res.json?.error || res.text || fallback || `HTTP ${res.status}`;
}

async function fetchWithRetry(exec: () => Promise<Response>) {
  let last: any = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await exec();
      if (res.ok || ![429, 500, 502, 503, 504].includes(res.status)) return res;
      last = res;
    } catch (e) {
      last = e;
    }
    if (attempt < RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  if (last instanceof Response) return last;
  throw last || new Error("FAZZ request failed");
}

async function fazzPost(path: string, payload: any, idemKey?: string): Promise<FazzResp> {
  const url = `${API_BASE}${path}`;
  const res = await fetchWithRetry(() =>
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
        ...(idemKey ? { "Idempotency-Key": idemKey } : {}),
      },
      body: JSON.stringify(payload),
    })
  );
  let json: any = null, text = "";
  try { json = await res.clone().json(); } catch { text = await res.text(); }
  if (!res.ok && DEBUG) {
    console.error("[FAZZ_POST_FAILED]", JSON.stringify({ status: res.status, url, body: json ?? text, sent: payload }, null, 2));
  }
  return { ok: res.ok, status: res.status, json, text, url };
}

async function fazzGet(path: string): Promise<FazzResp> {
  const url = `${API_BASE}${path}`;
  const res = await fetchWithRetry(() =>
    fetch(url, {
      method: "GET",
      headers: { Authorization: basicAuthHeader(), Accept: "application/vnd.api+json" },
    })
  );
  let json: any = null, text = "";
  try { json = await res.clone().json(); } catch { text = await res.text(); }
  if (!res.ok && DEBUG) {
    console.error("[FAZZ_GET_FAILED]", JSON.stringify({ status: res.status, url, body: json ?? text }, null, 2));
  }
  return { ok: res.ok, status: res.status, json, text, url };
}

function firstNonEmpty(...vals: any[]) {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return undefined;
}

/* ---------------- REAL calls ---------------- */

async function realCreateDepositIntent(input: DepositIntentInput): Promise<DepositIntentResult> {
  ensureRealReady();

  const isDynamic = input.methodCode.toUpperCase().includes("DYNAMIC");
  const bankCode = normalizeIdrV4BankCode(input.bankCode);
  const displayName = normalizeNameForBank(input.kyc.fullName, bankCode);
  const suffixNo = suffixNoFromTid(input.tid);
  // IMPORTANT:
  // - Dynamic: send expiredAt in Asia/Jakarta with +07:00, >= 61m ahead (we use 65m).
  // - Static: do NOT send expiredAt (payment method itself is reusable/unlimited).
  const expiredAtDynamic = jakartaFutureIso(65);
  const description = "FUND TRANSFER";

  const userId = !isDynamic
    ? (await prisma.user.findUnique({ where: { publicId: input.uid }, select: { id: true } }))?.id
    : null;

  let storedPaymentMethod:
    | { providerPaymentMethodId: string; accountNo?: string | null; accountName?: string | null; displayName?: string | null }
    | null = null;

  if (!isDynamic) {
    if (!userId) {
      throw new Error("User not found for static VA");
    }
    storedPaymentMethod = await prisma.providerPaymentMethod.findFirst({
      where: {
        provider: "FAZZ",
        type: "virtual_bank_account",
        merchantId: input.merchantId,
        userId,
        bankCode, // normalized
        active: true,
      },
      select: { providerPaymentMethodId: true, accountNo: true, accountName: true, displayName: true },
    });
  }

  const buildPaymentPayload = (paymentMethodId?: string, useRelationships = false) => {
    const attributes: any = {
      amount: Number(input.amountCents),
      currency: input.currency,
      referenceId: input.tid,
      paymentMethodType: "virtual_bank_account",
      description,
      paymentMethodOptions: {
        bankShortCode: bankCode, // normalized
        displayName,
        mode: isDynamic ? "DYNAMIC" : "STATIC",
        suffixNo,
      },
      metadata: {
        uid: input.uid,
        merchantId: input.merchantId,
        methodCode: input.methodCode,
      },
    };

    // Only include expiredAt for dynamic VAs
    if (isDynamic) {
      attributes.expiredAt = expiredAtDynamic;
    }

    const payload: any = { data: { type: "payments", attributes } };
    if (paymentMethodId) {
      if (useRelationships) {
        payload.data.relationships = {
          payment_method: {
            data: { type: "payment_methods", id: paymentMethodId },
          },
        };
      } else {
        attributes.paymentMethod = { id: paymentMethodId };
      }
    }
    return payload;
  };

  const ensurePaymentMethod = async () => {
    if (storedPaymentMethod?.providerPaymentMethodId) return storedPaymentMethod;
    if (isDynamic) return null;
    if (!userId) return null;

    const createPayload = {
      data: {
        type: "payment_methods",
        attributes: {
          bankShortCode: bankCode, // normalized
          referenceId: input.tid,
          displayName,
          suffixNo,
        },
      },
    };
    const createRes = await fazzPost(`/payment_methods/virtual_bank_accounts`, createPayload, input.tid);
    if (!createRes.ok) {
      const msg = renderProviderError(createRes, `HTTP ${createRes.status}`);
      throw new Error(`Fazz createPaymentMethod failed: ${msg}`);
    }

    const createJson = createRes.json ?? {};
    const parsed = parsePaymentMethodResp(createJson, displayName, bankCode);
    let accountNo = parsed.va.accountNo;
    let accountName = parsed.va.accountName || displayName;

    if (parsed.providerPaymentMethodId && (!accountNo || !accountName)) {
      const details = await fetchPaymentMethodDetails(parsed.providerPaymentMethodId);
      if (details) {
        accountNo = accountNo || details.va.accountNo || undefined;
        accountName = accountName || details.va.accountName || displayName;
        (createJson as any).__fetchedPaymentMethod = details.json;
      }
    }

    let record = null;
    try {
      record = await prisma.providerPaymentMethod.create({
        data: {
          provider: "FAZZ",
          type: "virtual_bank_account",
          merchantId: input.merchantId,
          userId,
          bankCode, // normalized
          providerPaymentMethodId: parsed.providerPaymentMethodId,
          accountNo: accountNo ?? null,
          accountName: accountName ?? null,
          displayName,
          active: true,
          metaJson: createJson,
        },
      });
    } catch {
      record = await prisma.providerPaymentMethod.findFirst({
        where: { provider: "FAZZ", providerPaymentMethodId: parsed.providerPaymentMethodId },
        select: { providerPaymentMethodId: true, accountNo: true, accountName: true, displayName: true },
      });
    }

    storedPaymentMethod = record
      ? {
          providerPaymentMethodId: record.providerPaymentMethodId,
          accountNo: record.accountNo,
          accountName: record.accountName,
          displayName: record.displayName,
        }
      : {
          providerPaymentMethodId: parsed.providerPaymentMethodId,
          accountNo,
          accountName,
        };

    return storedPaymentMethod;
  };

  const staticMethod = await ensurePaymentMethod();
  const paymentMethodId = staticMethod?.providerPaymentMethodId;

  const payload = buildPaymentPayload(paymentMethodId, Boolean(paymentMethodId));
  let res = await fazzPost(`/payments`, payload, input.tid);
  if (!res.ok && paymentMethodId && res.status === 400) {
    const fallbackPayload = buildPaymentPayload(paymentMethodId, false);
    res = await fazzPost(`/payments`, fallbackPayload, input.tid);
  }
  if (!res.ok) {
    const msg = renderProviderError(res, `HTTP ${res.status}`);
    throw new Error(`Fazz createDepositIntent failed: ${msg}`);
  }

  const json = res.json ?? {};
  const parsed = parseCreateResp(json, displayName, bankCode);

  // Backfill PM id + VA if missing
  let resolvedPaymentMethodId = parsed.paymentMethodId || paymentMethodId;
  let vaAccountNo = parsed.va.accountNo;
  let vaAccountName = parsed.va.accountName || staticMethod?.accountName || staticMethod?.displayName;

  if (!resolvedPaymentMethodId || !vaAccountNo) {
    const details = await fetchPaymentDetails(parsed.providerPaymentId);
    if (details) {
      resolvedPaymentMethodId = resolvedPaymentMethodId || details.paymentMethodId || undefined;
      vaAccountNo = vaAccountNo || details.va.accountNo || undefined;
      vaAccountName = vaAccountName || details.va.accountName || displayName;
      (json as any).__fetchedPayment = details.json;
    }
  }
  if (!resolvedPaymentMethodId) {
    const { id: fromList, raw } = await fetchPaymentMethodsForPayment(parsed.providerPaymentId);
    if (fromList) resolvedPaymentMethodId = fromList;
    (json as any).__fetchedPaymentMethods = raw;
  }

  const accountNo = vaAccountNo || staticMethod?.accountNo || dynamicVaNumber();

  const meta: any = {};
  if (resolvedPaymentMethodId) meta.paymentMethodId = resolvedPaymentMethodId;
  const fetched: any = {};
  if ((json as any).__fetchedPayment) fetched.payment = (json as any).__fetchedPayment;
  if ((json as any).__fetchedPaymentMethods) fetched.paymentMethods = (json as any).__fetchedPaymentMethods;
  if (Object.keys(fetched).length) meta.fetched = fetched;
  if (resolvedPaymentMethodId) (json as any).__paymentMethodId = resolvedPaymentMethodId;

  return {
    providerPaymentId: String(parsed.providerPaymentId),
    expiresAt: parsed.expiresAt,
    instructions: {
      type: "virtual_account",
      method: isDynamic ? "DYNAMIC" : "STATIC",
      bankCode, // normalized outward
      steps: [
        "Open your banking app.",
        `Transfer ${formatAmountForDisplay(input.amountCents, input.currency)} to the VA below.`,
        "Use immediate transfer if available.",
      ],
      meta,
    },
    va: {
      bankCode, // normalized outward
      accountNo,
      accountName: vaAccountName || displayName,
      meta,
    },
  };
}

async function realGetDepositStatus(providerPaymentId: string) {
  ensureRealReady();
  const res = await fazzGet(`/payments/${encodeURIComponent(providerPaymentId)}`);
  if (!res.ok) {
    const msg = renderProviderError(res, `HTTP ${res.status}`);
    throw new Error(`Fazz getDepositStatus failed: ${msg}`);
  }
  const json = res.json ?? {};
  const status =
    pick<string>(json, [
      "data.attributes.status",
      "status",
      "data.status",
      "payment.status",
    ]) || "pending";

  // Persist for portals (best-effort)
  try {
    await prisma.providerPayment.updateMany({
      where: { providerPaymentId },
      data: { status, rawLatestJson: json, updatedAt: new Date() },
    });
  } catch {}

  // ADDED: platformStatus
  return { status, platformStatus: mapFazzPaymentStatusToPlatform(status), raw: json };
}

async function realValidateBankAccount(input: { bankCode: string; accountNo: string; name?: string }) {
  ensureRealReady();
  const bankCode = normalizeIdrV4BankCode(input.bankCode);
  const payload = {
    data: {
      attributes: {
        bankShortCode: bankCode, // normalized
        accountNo: input.accountNo,
      },
    },
  };
  const res = await fazzPost(`/validation_services/bank_account_validation`, payload);
  if (!res.ok) {
    return { ok: false, holder: undefined, raw: res.json ?? res.text ?? { status: res.status, url: res.url } };
  }
  const holder =
    pick<string>(res.json, [
      "data.attributes.holderName",
      "data.attributes.accountName",
      "holderName",
      "accountName",
    ]);
  return { ok: Boolean(holder), holder, raw: res.json };
}

async function tryCreateSend(
  path: "/disbursements" | "/payouts",
  input: {
    tid: string; merchantId: string; uid: string; amountCents: number; currency: string;
    bankCode: string; accountNo: string; holderName: string;
  }
) {
  const amountNumber = Number(input.amountCents);
  const bankCode = normalizeIdrV4BankCode(input.bankCode);

  const payload = {
    data: {
      attributes: {
        amount: amountNumber,
        currency: input.currency,
        referenceId: input.tid,
        description: `Withdrawal ${input.tid}`,
        disbursementMethod: {
          type: "bank_transfer",
          bankShortCode: bankCode, // normalized
          bankAccountNo: input.accountNo,
          bankAccountHolderName: normalizeNameForBank(input.holderName, bankCode),
        },
        metadata: {
          uid: input.uid,
          merchantId: input.merchantId,
        },
      },
    },
  };

  const res = await fazzPost(path, payload, input.tid);
  return res;
}

async function realCreateDisbursement(input: {
  tid: string;
  merchantId: string;
  uid: string;
  amountCents: number;
  currency: string;
  bankCode: string;
  accountNo: string;
  holderName: string;
}) {
  ensureRealReady();

  const prefer = SEND_PREFERENCE; // DISBURSEMENTS | PAYOUTS | AUTO
  const order: Array<"/disbursements" | "/payouts"> =
    prefer === "DISBURSEMENTS" ? ["/disbursements", "/payouts"]
    : prefer === "PAYOUTS" ? ["/payouts", "/disbursements"]
    : ["/disbursements", "/payouts"];

  let last: FazzResp | null = null;
  for (const p of order) {
    const res = await tryCreateSend(p, input);
    last = res;
    if (res.ok) {
      const json = res.json ?? {};
      const providerPayoutId =
        pick<string>(json, ["data.id"]) ||
        pick<string>(json, ["id"]) ||
        makeFakeId(p === "/payouts" ? "pout" : "dsb");
      return { providerPayoutId: String(providerPayoutId), raw: json };
    }
    if (isPathMissingOrForbidden(res)) {
      continue;
    }
    const msg = renderProviderError(res, `HTTP ${res.status}`);
    throw new Error(`Fazz createDisbursement failed: ${msg}`);
  }
  if (last) {
    const msg = renderProviderError(last, `HTTP ${last.status}`);
    throw new Error(`Fazz createDisbursement failed: ${msg}`);
  }
  throw new Error("Fazz createDisbursement failed: unknown");
}

async function realGetDisbursementStatus(providerPayoutId: string) {
  ensureRealReady();

  const first = await fazzGet(`/disbursements/${encodeURIComponent(providerPayoutId)}`);
  let res = first;
  if (!first.ok && isPathMissingOrForbidden(first)) {
    const second = await fazzGet(`/payouts/${encodeURIComponent(providerPayoutId)}`);
    res = second;
  }
  if (!res.ok) {
    const msg = renderProviderError(res, `HTTP ${res.status}`);
    throw new Error(`Fazz getDisbursementStatus failed: ${msg}`);
  }

  const json = res.json ?? {};
  const status =
    pick<string>(json, [
      "data.attributes.status",
      "status",
      "data.status",
      "disbursement.status",
      "payout.status",
    ]) || "processing";

  try {
    await prisma.providerDisbursement.updateMany({
      where: { providerPayoutId },
      data: { status, rawLatestJson: json, updatedAt: new Date() },
    });
  } catch {}

  // ADDED: platformStatus
  return { status, platformStatus: mapFazzDisbursementStatusToPlatform(status), raw: json };
}

/* ---------------- Balance (new) ---------------- */

export type FazzBalance = { total: string; available: string; pending: string; raw?: any };

async function realGetBalance(): Promise<FazzBalance> {
  ensureRealReady();
  const res = await fazzGet(`/overviews/balance_overview`);
  if (!res.ok) {
    const msg = renderProviderError(res, `HTTP ${res.status}`);
    throw new Error(`Fazz getBalance failed: ${msg}`);
  }
  const total = pick<string>(res.json, ["data.attributes.totalBalance"]) ?? "0.0";
  const available = pick<string>(res.json, ["data.attributes.availableBalance"]) ?? "0.0";
  const pending = pick<string>(res.json, ["data.attributes.pendingBalance"]) ?? "0.0";
  return { total, available, pending, raw: res.json };
}

/** Public helper the router can call without changing ProviderAdapter typing */
export async function fazzGetBalance(): Promise<FazzBalance> {
  if (MODE === "REAL") return realGetBalance();
  return { total: "1000000.0", available: "1000000.0", pending: "0.0", raw: { simulated: true } };
}

/* ---------------- public adapter ---------------- */

export const fazzAdapter: ProviderAdapter = {
  async createDepositIntent(input: DepositIntentInput): Promise<DepositIntentResult> {
    if (MODE === "REAL") {
      return realCreateDepositIntent(input);
    }

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

    // Return SIM expiry in +07:00 too (for consistent display)
    const simExpiresAt = jakartaFutureIso(isDynamic ? 30 : 7 * 24 * 60);

    return {
      providerPaymentId,
      expiresAt: simExpiresAt,
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
        return {
          status: pp.status,
          platformStatus: mapFazzPaymentStatusToPlatform(pp.status),
          raw: pp.rawLatestJson ?? { source: "db", providerPaymentId, status: pp.status },
        };
      }
    } catch {}
    const h = crypto.createHash("sha256").update(providerPaymentId).digest("hex");
    const bucket = parseInt(h.slice(0, 2), 16) % 3;
    const status = bucket === 0 ? "pending" : bucket === 1 ? "paid" : "completed";
    return {
      status,
      platformStatus: mapFazzPaymentStatusToPlatform(status),
      raw: { simulated: true, providerPaymentId, status },
    };
  },

  async cancelDeposit(_providerPaymentId?: string) {
    // optional; no-op
  },

  async validateBankAccount(input: { bankCode: string; accountNo: string; name?: string }) {
    if (MODE === "REAL") return realValidateBankAccount(input);

    const holder = "VALIDATED HOLDER";
    return { ok: true, holder, raw: { simulated: true, bankCode: input.bankCode, accountNo: input.accountNo, holder } };
  },

  async createDisbursement(input: {
    tid: string;
    merchantId: string;
    uid: string;
    amountCents: number;
    currency: string;
    bankCode: string;
    accountNo: string;
    holderName: string;
  }) {
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
        return {
          status: pd.status,
          platformStatus: mapFazzDisbursementStatusToPlatform(pd.status),
          raw: pd.rawLatestJson ?? { source: "db", providerPayoutId, status: pd.status },
        };
      }
    } catch {}
    const h = crypto.createHash("sha256").update(providerPayoutId).digest("hex");
    const bucket = parseInt(h.slice(0, 2), 16) % 3;
    const status = bucket === 0 ? "processing" : bucket === 1 ? "completed" : "failed";
    return {
      status,
      platformStatus: mapFazzDisbursementStatusToPlatform(status),
      raw: { simulated: true, providerPayoutId, status },
    };
  },
};