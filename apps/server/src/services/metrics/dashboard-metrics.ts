import { prisma } from "../../lib/prisma.js";

// Jakarta midnight (UTC-7 offset) without deps
function jakartaStartOfTodayUTC(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now).split("-");
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 7 * 60 * 60 * 1000);
}

async function hasTable(qualified: string) {
  try {
    const rows = await prisma.$queryRaw<{ regclass: string | null }[]>`
      SELECT to_regclass(${qualified}) as regclass
    `;
    return !!rows?.[0]?.regclass;
  } catch {
    return false;
  }
}

export async function getDashboardMetrics(opts: { merchantId?: string } = {}) {
  const { merchantId } = opts;

  const hasTxCamel = await hasTable(`public."Transaction"`);
  const hasTxLower = hasTxCamel ? true : await hasTable(`public.transactions`);
  const since = jakartaStartOfTodayUTC();

  // Prefer authoritative platform transactions table if available
  if (hasTxCamel || hasTxLower) {
    const tbl = hasTxCamel ? `"Transaction"` : `transactions`;

    const whereMerchant = merchantId ? ` AND merchant_id = $2` : ``;
    const paramsPD = merchantId ? ["DEPOSIT", "PENDING", merchantId] : ["DEPOSIT", "PENDING"];
    const paramsPW = merchantId ? ["WITHDRAWAL", "PENDING", merchantId] : ["WITHDRAWAL", "PENDING"];

    // pending counts
    const [pdRow] = await prisma.$queryRawUnsafe<{ count: string }[]>(
      `SELECT COUNT(*) AS count FROM ${tbl} WHERE type = $1 AND status = $2${whereMerchant}`,
      ...paramsPD,
    );
    const [pwRow] = await prisma.$queryRawUnsafe<{ count: string }[]>(
      `SELECT COUNT(*) AS count FROM ${tbl} WHERE type = $1 AND status = $2${whereMerchant}`,
      ...paramsPW,
    );

    // today sums (approved)
    const whereMerchant2 = merchantId ? ` AND merchant_id = $3` : ``;
    const paramsTD = merchantId ? ["DEPOSIT", "APPROVED", since, merchantId] : ["DEPOSIT", "APPROVED", since];
    const paramsTW = merchantId ? ["WITHDRAWAL", "APPROVED", since, merchantId] : ["WITHDRAWAL", "APPROVED", since];

    const [tdRow] = await prisma.$queryRawUnsafe<{ sum: string | null }[]>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS sum
       FROM ${tbl}
       WHERE type = $1 AND status = $2 AND created_at >= $3${whereMerchant2}`,
      ...paramsTD,
    );
    const [twRow] = await prisma.$queryRawUnsafe<{ sum: string | null }[]>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS sum
       FROM ${tbl}
       WHERE type = $1 AND status = $2 AND created_at >= $3${whereMerchant2}`,
      ...paramsTW,
    );

    const toIdr = (cents: string | null) => Math.round(Number(cents ?? "0") / 100);

    return {
      pendingDeposits: Number(pdRow?.count ?? "0"),
      pendingWithdrawals: Number(pwRow?.count ?? "0"),
      todayDeposits: toIdr(tdRow?.sum ?? "0"),
      todayWithdrawals: toIdr(twRow?.sum ?? "0"),
    };
  }

  // Fallback: derive *safe* counts from FAZZ provider tables so UI can render.
  // (Totals may differ from your platform model until we point to the exact table.)
  const [pendingDeposits, pendingWithdrawals] = await Promise.all([
    prisma.providerPayment.count({
      where: { provider: "FAZZ", status: { in: ["pending", "processing"] } },
    }),
    prisma.providerDisbursement.count({
      where: { provider: "FAZZ", status: { in: ["pending", "processing"] } },
    }),
  ]);

  return {
    pendingDeposits,
    pendingWithdrawals,
    todayDeposits: 0,
    todayWithdrawals: 0,
  };
}