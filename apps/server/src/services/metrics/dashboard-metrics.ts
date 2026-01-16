import { prisma } from "../../lib/prisma.js";
import { startOfDay } from "date-fns-tz";

const JKT_TZ = "Asia/Jakarta";

function jakartaStartOfToday(): Date {
  const now = new Date();
  const start = startOfDay(now, { timeZone: JKT_TZ });
  return start;
}

export async function getDashboardMetrics(opts: { merchantId?: string } = {}) {
  const { merchantId } = opts;
  const baseWhere = {
    ...(merchantId ? { merchantId } : {}),
  };

  const [pendingDeposits, pendingWithdrawals, todayDepSum, todayWdrSum] = await Promise.all([
    prisma.transaction.count({
      where: { ...baseWhere, type: "DEPOSIT", status: "PENDING" },
    }),
    prisma.transaction.count({
      where: { ...baseWhere, type: "WITHDRAWAL", status: "PENDING" },
    }),
    prisma.transaction.aggregate({
      _sum: { amountCents: true },
      where: {
        ...baseWhere,
        type: "DEPOSIT",
        status: "APPROVED",
        createdAt: { gte: jakartaStartOfToday() },
      },
    }),
    prisma.transaction.aggregate({
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
