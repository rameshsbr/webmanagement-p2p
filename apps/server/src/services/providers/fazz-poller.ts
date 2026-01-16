import { prisma } from "../../lib/prisma.js";
import { fazzAdapter } from "./fazz.js";
import type { PlatformPaymentStatus } from "./fazz.js";

const POLL_FIRST_MS = Number(process.env.FAZZ_SYNC_POLL_FIRST_MS ?? 2500);
const POLL_BACKOFF_MS = Number(process.env.FAZZ_SYNC_POLL_BACKOFF_MS ?? 5000);
const POLL_MAX_TRIES = Number(process.env.FAZZ_SYNC_POLL_MAX_TRIES ?? 24);
const SWEEP_INTERVAL_MS = Number(process.env.FAZZ_SYNC_SWEEP_MS ?? 60_000);
const FAZZ_MODE = String(process.env.FAZZ_MODE || "SIM").toUpperCase();

type Terminal = "completed" | "failed" | "cancelled" | "expired";

const terminalPayments = new Set<Terminal>(["completed", "failed", "cancelled", "expired"]);
const terminalDisb = new Set<Terminal>(["completed", "failed", "cancelled"]);

// Keep existing helper in case you reintroduce methodCode filtering elsewhere.
function isIdrv4(methodCode?: string) {
  const m = String(methodCode || "").toUpperCase();
  return m.includes("VIRTUAL_BANK_ACCOUNT");
}

function toPlatformStatus(raw: string): PlatformPaymentStatus {
  const s = (raw || "").toLowerCase();
  if (s === "completed") return "APPROVED";
  if (s === "failed" || s === "cancelled") return "REJECTED";
  return "PENDING";
}

/** Shared: best-effort to find the Transaction model delegate despite Prisma name clashes/renames. */
function getTxDelegate() {
  const p: any = prisma as any;
  return p.transaction ?? p.transactions ?? p.Transaction ?? p.Transactions ?? null;
}

async function upsertPaymentRaw(providerPaymentId: string, rawStatus: string, rawJson: any) {
  const platformStatus = toPlatformStatus(rawStatus);
  try {
    await prisma.providerPayment.updateMany({
      where: { providerPaymentId },
      data: { status: rawStatus, rawLatestJson: rawJson, updatedAt: new Date() },
    });
  } catch {}
  try {
    const tx = getTxDelegate();
    if (tx) {
      await tx.updateMany({
        where: { providerPaymentId },
        data: { status: platformStatus, updatedAt: new Date() },
      });
    }
  } catch {}
}

async function upsertDisbRaw(providerPayoutId: string, rawStatus: string, rawJson: any) {
  const platformStatus = toPlatformStatus(rawStatus);
  try {
    await prisma.providerDisbursement.updateMany({
      where: { providerPayoutId },
      data: { status: rawStatus, rawLatestJson: rawJson, updatedAt: new Date() },
    });
  } catch {}
  try {
    const tx = getTxDelegate();
    if (tx) {
      await tx.updateMany({
        where: { providerPayoutId },
        data: { status: platformStatus, updatedAt: new Date() },
      });
    }
  } catch {}
}

export async function schedulePaymentPoll(providerPaymentId: string) {
  let tries = 0;
  const tick = async () => {
    tries += 1;
    try {
      const { status, raw } = await fazzAdapter.getDepositStatus(providerPaymentId);
      await upsertPaymentRaw(providerPaymentId, status, raw);
      if (terminalPayments.has((status || "").toLowerCase() as Terminal)) return;
    } catch {}
    if (tries < POLL_MAX_TRIES) setTimeout(tick, tries === 1 ? POLL_FIRST_MS : POLL_BACKOFF_MS);
  };
  setTimeout(tick, POLL_FIRST_MS);
}

export async function scheduleDisbursementPoll(providerPayoutId: string) {
  let tries = 0;
  const tick = async () => {
    tries += 1;
    try {
      const { status, raw } = await fazzAdapter.getDisbursementStatus(providerPayoutId);
      await upsertDisbRaw(providerPayoutId, status, raw);
      if (terminalDisb.has((status || "").toLowerCase() as Terminal)) return;
    } catch {}
    if (tries < POLL_MAX_TRIES) setTimeout(tick, tries === 1 ? POLL_FIRST_MS : POLL_BACKOFF_MS);
  };
  setTimeout(tick, POLL_FIRST_MS);
}

export function startFazzSweep() {
  if (FAZZ_MODE !== "REAL") return;
  const paymentIdPattern = /^pay_[a-f0-9]{24,}$/i;
  const run = async () => {
    try {
      // Payments: only FAZZ, non-terminal (pending/processing/paid)
      const pay = await prisma.providerPayment.findMany({
        where: {
          provider: "FAZZ",
          status: { in: ["pending", "processing", "paid"] },
        },
        select: { providerPaymentId: true, status: true },
        take: 200,
      });
      for (const p of pay) {
        if (!p.providerPaymentId || !paymentIdPattern.test(p.providerPaymentId)) continue;
        try {
          const { status, raw } = await fazzAdapter.getDepositStatus(p.providerPaymentId);
          await upsertPaymentRaw(p.providerPaymentId, status, raw);
        } catch {}
      }

      // Disbursements: only FAZZ, non-terminal (pending/processing)
      const dsb = await prisma.providerDisbursement.findMany({
        where: {
          provider: "FAZZ",
          status: { in: ["pending", "processing"] },
        },
        select: { providerPayoutId: true },
        take: 200,
      });
      for (const d of dsb) {
        try {
          const { status, raw } = await fazzAdapter.getDisbursementStatus(d.providerPayoutId);
          await upsertDisbRaw(d.providerPayoutId, status, raw);
        } catch {}
      }
    } catch {}
  };

  setInterval(run, SWEEP_INTERVAL_MS);
}
