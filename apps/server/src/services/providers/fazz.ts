import type {
  ProviderAdapter,
  DepositIntentInput,
  DepositIntentResult,
} from "./Provider.js";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma.js";

/**
 * NOTE
 * - Still a SIMULATION (no outbound HTTP).
 * - Improvements:
 *   1) STATIC VA now deterministic per (merchantId + uid + bankCode)
 *   2) getDepositStatus / getDisbursementStatus prefer DB rows if present
 *   3) Account name normalization + per-bank length constraints
 */

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
  // Optional: upper-case and strip non-ASCII if you want stricter formatting
  // const ascii = raw.normalize("NFKD").replace(/[^\x20-\x7E]/g, "");
  // return ascii.toUpperCase().slice(0, limit);
  return raw.slice(0, limit);
}

/**
 * Deterministic static VA number:
 *  - prefix "988"
 *  - last 10 digits derived from a hash of merchantId + uid + bankCode
 */
function staticVaNumber(merchantId: string, uid: string, bankCode: string) {
  const h = crypto
    .createHash("sha1")
    .update(`${merchantId}|${uid}|${(bankCode || "").toUpperCase()}`)
    .digest("hex");
  // take digits from hash
  const digits = h.replace(/[^\d]/g, "") + "0000000000";
  const tail = digits.slice(0, 10);
  return "988" + tail;
}

/**
 * Dynamic VA number:
 *  - prefix "988"
 *  - last 10 digits based on current timestamp (keeps changing over time)
 */
function dynamicVaNumber() {
  const now = Date.now().toString();
  const tail = now.slice(-10).padStart(10, "0");
  return "988" + tail;
}

export const fazzAdapter: ProviderAdapter = {
  async createDepositIntent(input: DepositIntentInput): Promise<DepositIntentResult> {
    const isDynamic = input.methodCode.toUpperCase().includes("DYNAMIC");
    const now = Date.now();
    const expiresMs = isDynamic ? 30 * 60_000 : 7 * 24 * 60 * 60_000; // 30 min vs 7 days

    // providerPaymentId:
    // - keep it random for uniqueness but stable enough for your flows
    // - you can also derive from TID if you prefer determinism:
    //   const providerPaymentId = "pay_" + crypto.createHash("sha1").update(input.tid).digest("hex").slice(0,12);
    const providerPaymentId = makeFakeId("pay");

    // VA number
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
    // 1) Prefer DB if present (so your mark/approve scripts are honored)
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
      // ignore DB failures and fall through to simulation
    }

    // 2) Otherwise simulate deterministically
    const h = crypto.createHash("sha256").update(providerPaymentId).digest("hex");
    const bucket = parseInt(h.slice(0, 2), 16) % 3;
    const status = bucket === 0 ? "pending" : bucket === 1 ? "paid" : "completed";
    return { status, raw: { simulated: true, providerPaymentId, status } };
  },

  async cancelDeposit() {
    // no-op in simulation
  },

  async validateBankAccount({ bankCode, accountNo }) {
    // Simple simulation that always "validates"
    const holder = "VALIDATED HOLDER";
    return { ok: true, holder, raw: { simulated: true, bankCode, accountNo, holder } };
  },

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
    // 1) Prefer DB if present
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
      // ignore DB failures and fall through
    }

    // 2) Simulate
    const h = crypto.createHash("sha256").update(providerPayoutId).digest("hex");
    const bucket = parseInt(h.slice(0, 2), 16) % 3;
    const status = bucket === 0 ? "processing" : bucket === 1 ? "completed" : "failed";
    return { status, raw: { simulated: true, providerPayoutId, status } };
  },
};
