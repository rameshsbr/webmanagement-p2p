import type { ProviderAdapter, DepositIntentInput } from "./Provider";
import crypto from "node:crypto";

// Read env
const BASE = process.env.FAZZ_API_BASE!;
const KEY  = process.env.FAZZ_API_KEY!;
const SEC  = process.env.FAZZ_API_SECRET!;

function authHeader() {
  // Fazz v4-ID: HTTP Basic (apiKey as username + secret as password)
  const token = Buffer.from(`${KEY}:${SEC}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

function clampNameForBank(full: string, bankCode: string): string {
  const limit = Number(process.env.FAZZ_BANK_NAME_LIMIT_DEFAULT || "40");
  const cleaned = full.normalize("NFKC").replace(/[^\p{L}\p{N} .'-]/gu, "");
  return cleaned.slice(0, limit).trim();
}

async function http<T = any>(path: string, opts: RequestInit): Promise<T> {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}), ...authHeader() },
  } as any);
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }
  if (!res.ok) {
    const err = new Error(`FAZZ ${res.status} ${res.statusText}: ${text}`);
    (err as any).details = json || text;
    throw err;
  }
  return json as T;
}

export const fazzAdapter: ProviderAdapter = {
  async createDepositIntent(input: DepositIntentInput) {
    const accountName = clampNameForBank(input.kyc.fullName, input.bankCode);
    const isDynamic = input.methodCode.includes("DYNAMIC");

    if (isDynamic) {
      // DYNAMIC VA: create a payment with paymentMethodType=virtual_bank_account
      const body = {
        referenceId: input.tid,                      // keep your TID
        amount: input.amountCents,                   // in IDR cents? (align with your amountCents)
        currency: input.currency,                    // "IDR"
        paymentMethodType: "virtual_bank_account",
        paymentMethod: {
          bankCode: input.bankCode,
          accountName,
        },
      };
      const created = await http<any>("/payments", { method: "POST", body: JSON.stringify(body) });

      // Map response (adjust fields as per actual Fazz response)
      const providerPaymentId = created?.id || created?.data?.id;
      const expiresAt = created?.expiresAt || created?.data?.expiresAt;
      const instructions = created?.paymentMethod?.instructions || created?.data?.paymentMethod?.instructions;
      const accountNo = created?.paymentMethod?.accountNumber || created?.data?.paymentMethod?.accountNumber;

      return {
        providerPaymentId,
        expiresAt,
        instructions,
        va: { bankCode: input.bankCode, accountNo, accountName },
      };
    }

    // STATIC VA: ensure a persistent payment method (create once per user/merchant/bank)
    // 1) Try to retrieve existing binding from our DB at call-site (we’ll do DB in the route/service)
    // 2) If not found, create via /payment_methods/virtual_bank_accounts and persist binding
    // Below is a call helper only; DB persistence happens in the route logic:
    const createdBinding = await http<any>("/payment_methods/virtual_bank_accounts", {
      method: "POST",
      body: JSON.stringify({
        referenceId: input.tid, // still pass TID for idempotency
        bankCode: input.bankCode,
        accountName,
      }),
    });

    const accountNo = createdBinding?.accountNumber || createdBinding?.data?.accountNumber;

    return {
      providerPaymentId: createdBinding?.id || createdBinding?.data?.id, // store as binding id
      instructions: createdBinding?.instructions || createdBinding?.data?.instructions || null,
      va: { bankCode: input.bankCode, accountNo, accountName },
    };
  },

  async getDepositStatus(providerPaymentId: string) {
    const got = await http<any>(`/payments/${providerPaymentId}`, { method: "GET" });
    const status = got?.status || got?.data?.status || "pending";
    return { status, raw: got };
  },

  async validateBankAccount({ bankCode, accountNo }) {
    const payload = { bankCode, accountNumber: accountNo };
    const out = await http<any>("/validate_bank_account", { method: "POST", body: JSON.stringify(payload) });
    const holder = out?.accountHolderName || out?.data?.accountHolderName;
    return { ok: Boolean(holder), holder, raw: out };
  },

  async createDisbursement({ tid, amountCents, currency, bankCode, accountNo, holderName }) {
    const payload = {
      referenceId: tid,
      amount: amountCents,
      currency,
      destination: { type: "bank_account", bankCode, accountNumber: accountNo, accountHolderName: holderName },
    };
    const out = await http<any>("/disbursements", { method: "POST", body: JSON.stringify(payload) });
    const providerPayoutId = out?.id || out?.data?.id;
    return { providerPayoutId, raw: out };
  },

  async getDisbursementStatus(providerPayoutId: string) {
    const got = await http<any>(`/disbursements/${providerPayoutId}`, { method: "GET" });
    const status = got?.status || got?.data?.status || "pending";
    return { status, raw: got };
  },
};
