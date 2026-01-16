import { prisma } from "../../lib/prisma.js";

// No external tz lib; compute Jakarta start-of-day without dependencies.
const JKT_TZ = "Asia/Jakarta";

/** Best-effort to find the Transaction model delegate despite Prisma name clashes/renames. */
function getTxDelegate() {
  const p: any = prisma as any;
  // Try common variants if the model was renamed/pluralized/mapped
  return p.transaction ?? p.transactions ?? p.Transaction ?? p.Transactions ?? null;
}

/**
 * Returns a Date representing midnight today in Asia/Jakarta, expressed as an exact UTC instant.
 * We format Y-M-D in Jakarta, then construct the corresponding UTC moment (00:00 in Jakarta = 17:00 prev day UTC).
 */
function jakartaStartOfToday(): Date {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: JKT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(now).split("-").map((s) => Number(s));
  // 00:00:00 at Jakarta = UTC minus 7 hours
  const utcAtJakartaMidnightMs = Date.UTC(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0) - 7 * 60 * 60 * 1000;
  return new Date(utcAtJakartaMidnightMs);
}

export async function getDashboardMetrics(opts: { merchantId?: string } = {}) {
  const { merchantId } = opts;
  const baseWhere = {
    ...(merchantId ? { merchantId } : {}),
  };

  const tx = getTxDelegate();

  // If the delegate is not available, don’t crash the dashboard — return zeros and warn.
  if (!tx) {
    console.warn(
      "[metrics] Prisma delegate for Transaction not found. " +
        "Ensure your Prisma model is named `Transaction` (or update getTxDelegate to the correct delegate). " +
        "Dashboard metrics will show zeros until this is aligned."
    );
    return {
      pendingDeposits: 0,
      pendingWithdrawals: 0,
      todayDeposits: 0,
      todayWithdrawals: 0,
    };
  }

  const [pendingDeposits, pendingWithdrawals, todayDepSum, todayWdrSum] = await Promise.all([
    tx.count({
      where: { ...baseWhere, type: "DEPOSIT", status: "PENDING" },
    }),
    tx.count({
      where: { ...baseWhere, type: "WITHDRAWAL", status: "PENDING" },
    }),
    tx.aggregate({
      _sum: { amountCents: true },
      where: {
        ...baseWhere,
        type: "DEPOSIT",
        status: "APPROVED",
        createdAt: { gte: jakartaStartOfToday() },
      },
    }),
    tx.aggregate({
      _sum: { amountCents: true },
      where: {
        ...baseWhere,
        type: "WITHDRAWAL",
        status: "APPROVED",
        createdAt: { gte: jakartaStartOfToday() },
      },
    }),
  ]);

  const toIdr = (cents?: number | null) => Math.round((cents ?? 0) / 100);

  return {
    pendingDeposits,
    pendingWithdrawals,
    todayDeposits: toIdr(todayDepSum._sum.amountCents),
    todayWithdrawals: toIdr(todayWdrSum._sum.amountCents),
  };
}