import type { ProviderAdapter, DepositIntentInput, DepositIntentResult } from "./Provider.js";
import crypto from "node:crypto";

// For now we SIMULATE provider responses so your flow is testable without hitting real Fazz.
// Later, we’ll flip to real HTTP calls using fetch/undici/axios and your FAZZ_API_* env vars.

const makeFakeId = (prefix: string) =>
  prefix + "_" + crypto.randomBytes(6).toString("hex");

function truncateNameForBank(name: string, max = Number(process.env.FAZZ_BANK_NAME_LIMIT_DEFAULT || 40)) {
  // rough normalization; real banks may require uppercase + ASCII-only
  return (name || "").trim().slice(0, max);
}

export const fazzAdapter: ProviderAdapter = {
  async createDepositIntent(input: DepositIntentInput): Promise<DepositIntentResult> {
    // Map STATIC/DYNAMIC → we’ll just vary expiry to simulate behavior
    const isDynamic = input.methodCode.toUpperCase().includes("DYNAMIC");
    const now = Date.now();
    const expiresMs = isDynamic ? 30 * 60_000 : 7 * 24 * 60 * 60_000; // 30min vs 7d

    const providerPaymentId = makeFakeId("pay");
    const vaNumber = "988" + String(now).slice(-8); // fake-ish
    const accountName = truncateNameForBank(input.kyc.fullName);

    // Minimal instruction set the UI can render
    const instructions = {
      type: "virtual_account",
      method: isDynamic ? "DYNAMIC" : "STATIC",
      bankCode: input.bankCode,
      steps: [
        "Open your banking app.",
        `Transfer IDR ${(input.amountCents/100).toFixed(2)} to the VA below.`,
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
    // Simulate: randomly pending/paid/completed (keep deterministic-ish)
    const h = crypto.createHash("sha256").update(providerPaymentId).digest("hex");
    const bucket = parseInt(h.slice(0, 2), 16) % 3;
    const status = bucket === 0 ? "pending" : bucket === 1 ? "paid" : "completed";
    return { status, raw: { simulated: true, providerPaymentId, status } };
  },

  async cancelDeposit() {
    // no-op simulation
  },

  async validateBankAccount({ bankCode, accountNo }) {
    // Simulate a successful validation; holderName varies slightly
    const holder = "VALIDATED HOLDER";
    return { ok: true, holder, raw: { simulated: true, bankCode, accountNo, holder } };
  },

  async createDisbursement({ tid, amountCents, currency, bankCode, accountNo, holderName }) {
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
    const h = crypto.createHash("sha256").update(providerPayoutId).digest("hex");
    const bucket = parseInt(h.slice(0, 2), 16) % 3;
    const status = bucket === 0 ? "processing" : bucket === 1 ? "completed" : "failed";
    return { status, raw: { simulated: true, providerPayoutId, status } };
  },
};
