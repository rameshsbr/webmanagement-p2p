import { prisma } from "../../lib/prisma.js";
import { fazzAdapter } from "./fazz.js";
import type { PlatformPaymentStatus } from "./fazz.js";

const POLL_FIRST_MS = Number(process.env.FAZZ_SYNC_POLL_FIRST_MS ?? 2500);
const POLL_BACKOFF_MS = Number(process.env.FAZZ_SYNC_POLL_BACKOFF_MS ?? 5000);
const POLL_MAX_TRIES = Number(process.env.FAZZ_SYNC_POLL_MAX_TRIES ?? 24);
const SWEEP_INTERVAL_MS = Number(process.env.FAZZ_SYNC_SWEEP_MS ?? 60_000);

type Terminal = "completed" | "failed" | "cancelled" | "expired";

const terminalPayments = new Set<Terminal>(["completed", "failed", "cancelled", "expired"]);
const terminalDisb = new Set<Terminal>(["completed", "failed", "cancelled"]);

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

async function upsertPaymentRaw(providerPaymentId: string, rawStatus: string, rawJson: any) {
  const platformStatus = toPlatformStatus(rawStatus);
  try {
    await prisma.providerPayment.updateMany({
      where: { providerPaymentId },
      data: { status: rawStatus, rawLatestJson: rawJson, updatedAt: new Date() },
    });
  } catch {}
  try {
    // Make this safe for schemas without a `transaction` model
    const anyPrisma = prisma as any;
    if (anyPrisma?.transaction?.updateMany) {
      await anyPrisma.transaction.updateMany({
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
    // Make this safe for schemas without a `transaction` model
    const anyPrisma = prisma as any;
    if (anyPrisma?.transaction?.updateMany) {
      await anyPrisma.transaction.updateMany({
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
  const run = async () => {
    try {
      const pay = await prisma.providerPayment.findMany({
        where: {
          provider: "FAZZ",
          // removed `{ status: null }` to satisfy Prisma’s type
          status: { in: ["pending", "processing", "paid"] },
        },
        // removed `methodCode` (not in schema)
        select: { providerPaymentId: true, status: true },
        take: 200,
      });
      for (const p of pay) {
        // was: if (!isIdrv4(p.methodCode)) continue;
        // We already scope by provider=FAZZ; leaving as FAZZ-only to avoid touching P2P.
        try {
          const { status, raw } = await fazzAdapter.getDepositStatus(p.providerPaymentId);
          await upsertPaymentRaw(p.providerPaymentId, status, raw);
        } catch {}
      }

      const dsb = await prisma.providerDisbursement.findMany({
        where: {
          provider: "FAZZ",
          // removed `{ status: null }` to satisfy Prisma’s type
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