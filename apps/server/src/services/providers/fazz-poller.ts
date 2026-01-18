import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { fazzAdapter } from "./fazz.js";
import {
  normalizeFazzPaymentStatus,
  normalizeFazzPayoutStatus,
  updatePaymentRequestFromProvider,
  type FazzAcceptNormalized,
  type FazzSendNormalized,
} from "./fazz/idr-v4-sync.js";

const POLL_FIRST_MS = Number(process.env.FAZZ_SYNC_POLL_FIRST_MS ?? 2500);
const POLL_BACKOFF_MS = Number(process.env.FAZZ_SYNC_POLL_BACKOFF_MS ?? 5000);
const POLL_MAX_TRIES = Number(process.env.FAZZ_SYNC_POLL_MAX_TRIES ?? 24);
const SWEEP_INTERVAL_MS = Number(process.env.FAZZ_SYNC_SWEEP_MS ?? 60_000);
const RECONCILE_STALE_MS = Number(process.env.FAZZ_RECONCILE_STALE_MS ?? 5 * 60_000);
const RECONCILE_RATE_RPS = Number(process.env.FAZZ_RECONCILE_RPS ?? 5);
const RECONCILE_BATCH = Number(process.env.FAZZ_RECONCILE_BATCH ?? 100);
const EXPIRE_SWEEP_MS = Number(process.env.FAZZ_EXPIRE_SWEEP_MS ?? 5 * 60_000);
const FAZZ_MODE = String(process.env.FAZZ_MODE || "SIM").toUpperCase();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMethodFilter(codes: string[]): Prisma.PaymentRequestWhereInput {
  const normalized = codes.map((c) => c.trim().toUpperCase());
  const methodFilters = normalized.map((code) => ({ detailsJson: { path: ["method"], equals: code } }));
  return {
    OR: [
      { method: { code: { in: normalized } } },
      { bankAccount: { method: { in: normalized } } },
      ...methodFilters,
    ],
  };
}

async function updateProviderPaymentStatus(
  providerPaymentId: string,
  rawStatus: string,
  normalizedStatus: FazzAcceptNormalized,
  rawJson: any,
  paymentRequestId?: string | null,
) {
  await prisma.providerPayment.updateMany({
    where: { providerPaymentId },
    data: {
      status: rawStatus,
      normalizedStatus,
      rawLatestJson: rawJson,
      updatedAt: new Date(),
    },
  });

  if (paymentRequestId) {
    await updatePaymentRequestFromProvider({
      paymentRequestId,
      kind: "accept",
      normalized: normalizedStatus,
      rawStatus,
    });
  }
}

async function updateProviderDisbursementStatus(
  providerPayoutId: string,
  rawStatus: string,
  normalizedStatus: FazzSendNormalized,
  rawJson: any,
  paymentRequestId?: string | null,
) {
  await prisma.providerDisbursement.updateMany({
    where: { providerPayoutId },
    data: {
      status: rawStatus,
      normalizedStatus,
      rawLatestJson: rawJson,
      updatedAt: new Date(),
    },
  });

  if (paymentRequestId) {
    await updatePaymentRequestFromProvider({
      paymentRequestId,
      kind: "send",
      normalized: normalizedStatus,
      rawStatus,
    });
  }
}

export async function schedulePaymentPoll(providerPaymentId: string) {
  let tries = 0;
  const tick = async () => {
    tries += 1;
    try {
      const out = await fazzAdapter.getDepositStatus(providerPaymentId);
      const rawStatus = String(out.status || "pending");
      const normalizedStatus = normalizeFazzPaymentStatus(rawStatus);
      const pp = await prisma.providerPayment.findFirst({
        where: { providerPaymentId },
        select: { paymentRequestId: true },
      });
      await updateProviderPaymentStatus(
        providerPaymentId,
        rawStatus,
        normalizedStatus,
        out.raw,
        pp?.paymentRequestId,
      );
      if (["PAID", "FAILED", "CANCELED", "EXPIRED"].includes(normalizedStatus)) return;
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
      const out = await fazzAdapter.getDisbursementStatus(providerPayoutId);
      const rawStatus = String(out.status || "processing");
      const normalizedStatus = normalizeFazzPayoutStatus(rawStatus);
      const pd = await prisma.providerDisbursement.findFirst({
        where: { providerPayoutId },
        select: { paymentRequestId: true },
      });
      await updateProviderDisbursementStatus(
        providerPayoutId,
        rawStatus,
        normalizedStatus,
        out.raw,
        pd?.paymentRequestId,
      );
      if (["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"].includes(normalizedStatus)) return;
    } catch {}
    if (tries < POLL_MAX_TRIES) setTimeout(tick, tries === 1 ? POLL_FIRST_MS : POLL_BACKOFF_MS);
  };
  setTimeout(tick, POLL_FIRST_MS);
}

export async function reconcileFazzAccept() {
  const cutoff = new Date(Date.now() - RECONCILE_STALE_MS);
  const now = new Date();
  let cursor: string | undefined;
  let updated = 0;

  while (true) {
    const rows = await prisma.providerPayment.findMany({
      where: {
        provider: "FAZZ",
        paymentRequest: {
          type: "DEPOSIT",
          status: "PENDING",
          ...buildMethodFilter(["VIRTUAL_BANK_ACCOUNT_DYNAMIC", "VIRTUAL_BANK_ACCOUNT_STATIC"]),
        },
        AND: [
          {
            OR: [
              { normalizedStatus: "PENDING_OPEN" },
              {
                normalizedStatus: null,
                status: { in: ["pending", "processing", "created", "awaiting_payment", "paid"] },
              },
            ],
          },
          {
            OR: [{ expiresAt: { lt: now } }, { updatedAt: { lt: cutoff } }],
          },
        ],
      },
      select: { id: true, providerPaymentId: true, paymentRequestId: true },
      orderBy: { id: "asc" },
      take: RECONCILE_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (!rows.length) break;
    for (const row of rows) {
      cursor = row.id;
      if (!row.providerPaymentId) continue;
      try {
        const out = await (fazzAdapter.fetchPayment
          ? fazzAdapter.fetchPayment(row.providerPaymentId)
          : fazzAdapter.getDepositStatus(row.providerPaymentId));
        const rawStatus = String(out.status || "pending");
        const normalizedStatus = normalizeFazzPaymentStatus(rawStatus);
        await updateProviderPaymentStatus(
          row.providerPaymentId,
          rawStatus,
          normalizedStatus,
          out.raw,
          row.paymentRequestId,
        );
        updated += 1;
      } catch {}
      if (RECONCILE_RATE_RPS > 0) {
        await sleep(Math.ceil(1000 / RECONCILE_RATE_RPS));
      }
    }
  }

  if (updated) {
    console.log("[FAZZ_RECONCILE_ACCEPT]", JSON.stringify({ updated }));
  }
}

export async function reconcileFazzSend() {
  const cutoff = new Date(Date.now() - RECONCILE_STALE_MS);
  let cursor: string | undefined;
  let updated = 0;

  while (true) {
    const rows = await prisma.providerDisbursement.findMany({
      where: {
        provider: "FAZZ",
        paymentRequest: {
          type: "WITHDRAWAL",
          status: { in: ["PENDING", "SUBMITTED"] },
          ...buildMethodFilter(["FAZZ_SEND"]),
        },
        OR: [
          { normalizedStatus: { in: ["QUEUED", "PROCESSING"] } },
          {
            normalizedStatus: null,
            status: { in: ["pending", "processing", "created", "queued"] },
          },
        ],
        updatedAt: { lt: cutoff },
      },
      select: { id: true, providerPayoutId: true, paymentRequestId: true },
      orderBy: { id: "asc" },
      take: RECONCILE_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (!rows.length) break;
    for (const row of rows) {
      cursor = row.id;
      if (!row.providerPayoutId) continue;
      try {
        const out = await (fazzAdapter.fetchPayout
          ? fazzAdapter.fetchPayout(row.providerPayoutId)
          : fazzAdapter.getDisbursementStatus(row.providerPayoutId));
        const rawStatus = String(out.status || "processing");
        const normalizedStatus = normalizeFazzPayoutStatus(rawStatus);
        await updateProviderDisbursementStatus(
          row.providerPayoutId,
          rawStatus,
          normalizedStatus,
          out.raw,
          row.paymentRequestId,
        );
        updated += 1;
      } catch {}
      if (RECONCILE_RATE_RPS > 0) {
        await sleep(Math.ceil(1000 / RECONCILE_RATE_RPS));
      }
    }
  }

  if (updated) {
    console.log("[FAZZ_RECONCILE_SEND]", JSON.stringify({ updated }));
  }
}

export async function expireIdrV4Vas() {
  const now = new Date();
  let cursor: string | undefined;
  let updated = 0;

  while (true) {
    const rows = await prisma.providerPayment.findMany({
      where: {
        provider: "FAZZ",
        expiresAt: { lt: now },
        paymentRequest: {
          status: "PENDING",
          type: "DEPOSIT",
          ...buildMethodFilter(["VIRTUAL_BANK_ACCOUNT_DYNAMIC", "VIRTUAL_BANK_ACCOUNT_STATIC"]),
        },
      },
      select: {
        id: true,
        providerPaymentId: true,
        paymentRequestId: true,
        status: true,
        rawLatestJson: true,
        paymentRequest: { select: { detailsJson: true, method: { select: { code: true } } } },
      },
      orderBy: { id: "asc" },
      take: RECONCILE_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (!rows.length) break;
    for (const row of rows) {
      cursor = row.id;
      if (!row.providerPaymentId || !row.paymentRequestId) continue;
      const rawStatus = row.status ? String(row.status) : "expired";
      const normalizedStatus = "EXPIRED" as const;
      await updateProviderPaymentStatus(
        row.providerPaymentId,
        "expired",
        normalizedStatus,
        row.rawLatestJson ?? { localExpire: true },
        row.paymentRequestId,
      );
      const methodCode = String(row.paymentRequest?.method?.code || (row.paymentRequest?.detailsJson as any)?.method || "").toUpperCase();
      if (methodCode === "VIRTUAL_BANK_ACCOUNT_DYNAMIC") {
        try {
          await fazzAdapter.cancelDeposit?.(row.providerPaymentId);
        } catch {}
      }
      updated += 1;
    }
  }

  if (updated) {
    console.log("[FAZZ_VA_EXPIRE]", JSON.stringify({ updated }));
  }
}

export function startFazzSweep() {
  if (FAZZ_MODE !== "REAL") return;
  setInterval(() => {
    reconcileFazzAccept().catch(() => {});
    reconcileFazzSend().catch(() => {});
  }, SWEEP_INTERVAL_MS);

  setInterval(() => {
    expireIdrV4Vas().catch(() => {});
  }, EXPIRE_SWEEP_MS);
}
