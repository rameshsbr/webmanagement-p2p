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

function toPlatformStatus(raw: string): PlatformPaymentStatus {
  const s = (raw || "").toLowerCase();
  if (s === "completed") return "APPROVED";
  if (s === "failed" || s === "cancelled" || s === "expired") return "REJECTED";
  return "PENDING";
}

// --- helpers: best-effort update into a platform txn table if it exists ---
async function touchPlatformTxForPayment(providerPaymentId: string, platformStatus: PlatformPaymentStatus) {
  try {
    // If a quoted "Transaction" relation exists, update it
    const rc1 = await prisma.$queryRaw<{ regclass: string | null }[]>`
      SELECT to_regclass('public."Transaction"') as regclass
    `;
    if (rc1?.[0]?.regclass) {
      await prisma.$executeRaw`
        UPDATE "Transaction"
        SET status = ${platformStatus}, updated_at = NOW()
        WHERE provider_payment_id = ${providerPaymentId};
      `;
      return;
    }

    // If a lowercased table exists (e.g. transactions), try that too
    const rc2 = await prisma.$queryRaw<{ regclass: string | null }[]>`
      SELECT to_regclass('public.transactions') as regclass
    `;
    if (rc2?.[0]?.regclass) {
      await prisma.$executeRawUnsafe(
        `UPDATE transactions SET status = $1, updated_at = NOW() WHERE provider_payment_id = $2`,
        platformStatus,
        providerPaymentId,
      );
    }
  } catch {
    // swallow — this is best-effort only, never block polling
  }
}

async function touchPlatformTxForPayout(providerPayoutId: string, platformStatus: PlatformPaymentStatus) {
  try {
    const rc1 = await prisma.$queryRaw<{ regclass: string | null }[]>`
      SELECT to_regclass('public."Transaction"') as regclass
    `;
    if (rc1?.[0]?.regclass) {
      await prisma.$executeRaw`
        UPDATE "Transaction"
        SET status = ${platformStatus}, updated_at = NOW()
        WHERE provider_payout_id = ${providerPayoutId};
      `;
      return;
    }

    const rc2 = await prisma.$queryRaw<{ regclass: string | null }[]>`
      SELECT to_regclass('public.transactions') as regclass
    `;
    if (rc2?.[0]?.regclass) {
      await prisma.$executeRawUnsafe(
        `UPDATE transactions SET status = $1, updated_at = NOW() WHERE provider_payout_id = $2`,
        platformStatus,
        providerPayoutId,
      );
    }
  } catch {
    // swallow
  }
}

// --- canonical upserts into provider tables (authoritative for FAZZ v4) ---
async function upsertPaymentRaw(providerPaymentId: string, rawStatus: string, rawJson: any) {
  const platformStatus = toPlatformStatus(rawStatus);
  try {
    await prisma.providerPayment.updateMany({
      where: { providerPaymentId },
      data: { status: rawStatus, rawLatestJson: rawJson, updatedAt: new Date() },
    });
  } catch {}
  // best-effort mirror into platform tx table if present
  await touchPlatformTxForPayment(providerPaymentId, platformStatus);
}

async function upsertDisbRaw(providerPayoutId: string, rawStatus: string, rawJson: any) {
  const platformStatus = toPlatformStatus(rawStatus);
  try {
    await prisma.providerDisbursement.updateMany({
      where: { providerPayoutId },
      data: { status: rawStatus, rawLatestJson: rawJson, updatedAt: new Date() },
    });
  } catch {}
  await touchPlatformTxForPayout(providerPayoutId, platformStatus);
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
      // Refresh FAZZ payments not terminal yet
      const pay = await prisma.providerPayment.findMany({
        where: { provider: "FAZZ", status: { in: ["pending", "processing", "paid"] } },
        select: { providerPaymentId: true },
        take: 200,
      });

      for (const p of pay) {
        try {
          const { status, raw } = await fazzAdapter.getDepositStatus(p.providerPaymentId);
          await upsertPaymentRaw(p.providerPaymentId, status, raw);
        } catch {}
      }

      // Refresh FAZZ disbursements not terminal yet
      const dsb = await prisma.providerDisbursement.findMany({
        where: { provider: "FAZZ", status: { in: ["pending", "processing"] } },
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