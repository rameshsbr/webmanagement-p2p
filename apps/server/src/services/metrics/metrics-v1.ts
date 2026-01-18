import { Prisma } from "@prisma/client";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { prisma } from "../../lib/prisma.js";
import { resolveTimezone } from "../../lib/timezone.js";
import { isIdrV4Method } from "../methods.js";

const IDR_V4_CODES = [
  "VIRTUAL_BANK_ACCOUNT_DYNAMIC",
  "VIRTUAL_BANK_ACCOUNT_STATIC",
  "FAZZ_SEND",
];
const AUD_NPP_CODE = "AUD_NPP";

function buildMethodFilter(codes: string[]): Prisma.PaymentRequestWhereInput {
  const normalized = codes.map((c) => c.trim().toUpperCase());
  const detailFilters = normalized.map((code) => ({ detailsJson: { path: ["method"], equals: code } }));
  return {
    OR: [
      { method: { code: { in: normalized } } },
      { bankAccount: { method: { in: normalized } } },
      ...detailFilters,
    ],
  };
}

/**
 * Parse a date string coming from the UI.
 * Supports:
 *  - YYYY-MM-DD
 *  - DD/MM/YYYY, DD-MM-YYYY  (preferred default for ambiguity)
 *  - MM/DD/YYYY              (used only when clearly MM/DD, e.g., 12/31/2026)
 * Returns a Date in UTC corresponding to the start/end of day in the given tz.
 */
function parseDateInput(value: string | undefined, tz: string, endOfDay: boolean) {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  // 1) ISO-like YYYY-MM-DD
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/;
  let m = raw.match(iso);
  if (m) {
    const [, y, mm, dd] = m;
    const time = endOfDay ? "T23:59:59.999" : "T00:00:00.000";
    return fromZonedTime(`${y}-${mm}-${dd}${time}`, tz);
  }

  // 2) DD/MM/YYYY or DD-MM-YYYY
  const dmy = /^(\d{2})[\/-](\d{2})[\/-](\d{4})$/;
  m = raw.match(dmy);
  if (m) {
    let [, dd, mm, y] = m;
    // Heuristic: treat as D/M/Y unless clearly M/D/Y (e.g., 12/31/2026)
    if (Number(dd) <= 12 && Number(mm) > 12) {
      [dd, mm] = [mm, dd];
    }
    const time = endOfDay ? "T23:59:59.999" : "T00:00:00.000";
    return fromZonedTime(`${y}-${mm}-${dd}${time}`, tz);
  }

  // 3) MM/DD/YYYY (clearly), e.g., 12/31/2026
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  m = raw.match(mdy);
  if (m) {
    const [, mm, dd, y] = m;
    const time = endOfDay ? "T23:59:59.999" : "T00:00:00.000";
    const mmP = String(mm).padStart(2, "0");
    const ddP = String(dd).padStart(2, "0");
    return fromZonedTime(`${y}-${mmP}-${ddP}${time}`, tz);
  }

  // 4) Fallback: let JS try; if invalid, return null
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildDateRange(fromRaw: string | undefined, toRaw: string | undefined, tz: string) {
  const now = new Date();
  const to = parseDateInput(toRaw, tz, true) ?? now;
  const from =
    parseDateInput(fromRaw, tz, false) ??
    fromZonedTime(
      formatInTimeZone(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000), tz, "yyyy-MM-dd") + "T00:00:00.000",
      tz,
    );
  return { from, to };
}

function resolveMethodCode(row: any) {
  return String(
    row?.method?.code ||
    row?.detailsJson?.method ||
    row?.bankAccount?.method ||
    "",
  )
    .trim()
    .toUpperCase();
}

function methodMatches(row: any, methodCode: string, filters: string[]) {
  if (!filters.length) return true;
  // Narrow detailsJson safely before reading custom keys like `rail`.
  const details = row?.detailsJson as Prisma.JsonObject | null;
  const rail = String((details && (details as any).rail) || "").trim().toUpperCase();
  for (const f of filters) {
    if (f === "P2P" && methodCode && !isIdrV4Method(methodCode) && methodCode !== AUD_NPP_CODE) return true;
    if (f === "IDR_VA_DYNAMIC" && methodCode === "VIRTUAL_BANK_ACCOUNT_DYNAMIC") return true;
    if (f === "IDR_VA_STATIC" && methodCode === "VIRTUAL_BANK_ACCOUNT_STATIC") return true;
    if (f === "IDR_SEND" && methodCode === "FAZZ_SEND") return true;
    if (f === "AUD_NPP" && methodCode === AUD_NPP_CODE) return true;
    if (f === "AUD_NPP_BANK" && methodCode === AUD_NPP_CODE && rail === "BANK_ACCOUNT") return true;
    if (f === "AUD_NPP_PAYID" && methodCode === AUD_NPP_CODE && rail === "PAYID") return true;
  }
  return false;
}

function formatDateBucket(date: Date, tz: string) {
  return formatInTimeZone(date, tz, "yyyy-MM-dd");
}

function initSeries(from: Date, to: Date, tz: string) {
  // Explicit counters to avoid index-signature conflicts with `date`
  type Counters = {
    starts?: number;
    completes?: number;
    pending?: number;
    approved?: number;
    rejected?: number;
    submitted?: number;
  };
  type SeriesDatum = { date: string } & Partial<Counters>;

  const series: Record<string, SeriesDatum> = {};
  let cursor = new Date(from.getTime());
  while (cursor <= to) {
    const label = formatDateBucket(cursor, tz);
    series[label] = { date: label };
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return series;
}

type MetricsFilters = {
  from?: string;
  to?: string;
  tz?: string;
  methods: string[];
  merchantIds: string[];
};

export async function getMetricsOverview(filters: MetricsFilters) {
  const tz = resolveTimezone(filters.tz || "UTC");
  const { from, to } = buildDateRange(filters.from, filters.to, tz);
  const merchantIds = filters.merchantIds;
  const methodFilters = filters.methods;

  const paymentWhere: Prisma.PaymentRequestWhereInput = {
    createdAt: { gte: from, lte: to },
  };
  if (merchantIds.length) paymentWhere.merchantId = { in: merchantIds };

  if (methodFilters.length) {
    const codes: string[] = [];
    if (methodFilters.includes("IDR_VA_DYNAMIC")) codes.push("VIRTUAL_BANK_ACCOUNT_DYNAMIC");
    if (methodFilters.includes("IDR_VA_STATIC")) codes.push("VIRTUAL_BANK_ACCOUNT_STATIC");
    if (methodFilters.includes("IDR_SEND")) codes.push("FAZZ_SEND");
    if (methodFilters.includes("AUD_NPP")) codes.push(AUD_NPP_CODE);
    const or: Prisma.PaymentRequestWhereInput[] = [];
    if (codes.length) {
      or.push(buildMethodFilter(codes));
    }
    if (methodFilters.includes("AUD_NPP_BANK")) {
      or.push({
        detailsJson: { path: ["method"], equals: AUD_NPP_CODE },
        AND: [{ detailsJson: { path: ["rail"], equals: "BANK_ACCOUNT" } }],
      });
    }
    if (methodFilters.includes("AUD_NPP_PAYID")) {
      or.push({
        detailsJson: { path: ["method"], equals: AUD_NPP_CODE },
        AND: [{ detailsJson: { path: ["rail"], equals: "PAYID" } }],
      });
    }
    if (methodFilters.includes("P2P")) {
      or.push({ NOT: buildMethodFilter([...IDR_V4_CODES, AUD_NPP_CODE]) });
    }
    if (or.length) {
      paymentWhere.OR = or;
    }
  }

  const payments = await prisma.paymentRequest.findMany({
    where: paymentWhere,
    select: {
      id: true,
      type: true,
      status: true,
      amountCents: true,
      createdAt: true,
      rejectedReason: true,
      detailsJson: true,
      method: { select: { code: true } },
      bankAccount: { select: { method: true } },
    },
  });

  const filteredPayments = methodFilters.length
    ? payments.filter((row) => methodMatches(row, resolveMethodCode(row), methodFilters))
    : payments;

  const depositRows = filteredPayments.filter((p) => p.type === "DEPOSIT");
  const withdrawalRows = filteredPayments.filter((p) => p.type === "WITHDRAWAL");

  const approvedDeposits = depositRows.filter((p) => p.status === "APPROVED");
  const rejectedDeposits = depositRows.filter((p) => p.status === "REJECTED");
  const approvedWithdrawals = withdrawalRows.filter((p) => p.status === "APPROVED");
  const rejectedWithdrawals = withdrawalRows.filter((p) => p.status === "REJECTED");

  const kycWhere: Prisma.KycVerificationWhereInput = {
    provider: "didit",
    createdAt: { gte: from, lte: to },
  };
  if (merchantIds.length) {
    kycWhere.user = { merchantClients: { some: { merchantId: { in: merchantIds } } } };
  }
  const kycStarts = await prisma.kycVerification.count({ where: kycWhere });

  const kycCompleteWhere: Prisma.KycVerificationWhereInput = {
    provider: "didit",
    status: "approved",
    updatedAt: { gte: from, lte: to },
  };
  if (merchantIds.length) {
    kycCompleteWhere.user = { merchantClients: { some: { merchantId: { in: merchantIds } } } };
  }
  const kycCompletes = await prisma.kycVerification.count({ where: kycCompleteWhere });

  const kycApprovedUsers = await prisma.user.findMany({
    where: {
      verifiedAt: { gte: from, lte: to },
      kyc: { some: { provider: "didit" } },
      ...(merchantIds.length
        ? { merchantClients: { some: { merchantId: { in: merchantIds } } } }
        : {}),
    },
    select: {
      verifiedAt: true,
      kyc: {
        where: { provider: "didit" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  const approvalDurations = kycApprovedUsers
    .map((u) => {
      const start = u.kyc?.[0]?.createdAt;
      const end = u.verifiedAt;
      if (!start || !end) return null;
      return end.getTime() - start.getTime();
    })
    .filter((v): v is number => typeof v === "number" && v >= 0);

  const avgTimeToApprovalMs = approvalDurations.length
    ? Math.round(approvalDurations.reduce((a, b) => a + b, 0) / approvalDurations.length)
    : 0;

  const vaAttemptWhere: Prisma.PaymentRequestWhereInput = {
    ...paymentWhere,
    type: "DEPOSIT",
    ...buildMethodFilter(["VIRTUAL_BANK_ACCOUNT_DYNAMIC", "VIRTUAL_BANK_ACCOUNT_STATIC"]),
  };
  const vaAttempts = await prisma.paymentRequest.count({ where: vaAttemptWhere });
  const vaCreates = await prisma.providerPayment.count({
    where: {
      provider: "FAZZ",
      createdAt: { gte: from, lte: to },
      ...(merchantIds.length ? { paymentRequest: { merchantId: { in: merchantIds } } } : {}),
    },
  });

  const seriesKyc = initSeries(from, to, tz);
  const seriesDeposits = initSeries(from, to, tz);
  const seriesWithdrawals = initSeries(from, to, tz);

  const kycRows = await prisma.kycVerification.findMany({
    where: { provider: "didit", createdAt: { gte: from, lte: to }, ...(kycWhere.user ? { user: kycWhere.user } : {}) },
    select: { createdAt: true, status: true, updatedAt: true },
  });
  for (const row of kycRows) {
    const bucket = formatDateBucket(row.createdAt, tz);
    seriesKyc[bucket] = seriesKyc[bucket] || { date: bucket };
    seriesKyc[bucket].starts = (seriesKyc[bucket].starts ?? 0) + 1;
    if (row.status === "approved") {
      const approvedBucket = formatDateBucket(row.updatedAt, tz);
      seriesKyc[approvedBucket] = seriesKyc[approvedBucket] || { date: approvedBucket };
      seriesKyc[approvedBucket].completes = (seriesKyc[approvedBucket].completes ?? 0) + 1;
    }
  }

  for (const row of depositRows) {
    const bucket = formatDateBucket(row.createdAt, tz);
    seriesDeposits[bucket] = seriesDeposits[bucket] || { date: bucket };
    if (row.status === "PENDING") {
      seriesDeposits[bucket].pending = (seriesDeposits[bucket].pending ?? 0) + 1;
    } else if (row.status === "APPROVED") {
      seriesDeposits[bucket].approved = (seriesDeposits[bucket].approved ?? 0) + 1;
    } else if (row.status === "REJECTED") {
      seriesDeposits[bucket].rejected = (seriesDeposits[bucket].rejected ?? 0) + 1;
    }
  }

  for (const row of withdrawalRows) {
    const bucket = formatDateBucket(row.createdAt, tz);
    seriesWithdrawals[bucket] = seriesWithdrawals[bucket] || { date: bucket };
    if (row.status === "SUBMITTED") {
      seriesWithdrawals[bucket].submitted = (seriesWithdrawals[bucket].submitted ?? 0) + 1;
    } else if (row.status === "APPROVED") {
      seriesWithdrawals[bucket].approved = (seriesWithdrawals[bucket].approved ?? 0) + 1;
    } else if (row.status === "REJECTED") {
      seriesWithdrawals[bucket].rejected = (seriesWithdrawals[bucket].rejected ?? 0) + 1;
    }
  }

  const rejectReasonsMap = new Map<string, number>();
  for (const row of filteredPayments.filter((p) => p.status === "REJECTED")) {
    const reason = row.rejectedReason || "UNKNOWN";
    rejectReasonsMap.set(reason, (rejectReasonsMap.get(reason) || 0) + 1);
  }

  const methodBreakdownMap = new Map<string, { method: string; approvedSumCents: number; approvedCount: number }>();
  for (const row of filteredPayments.filter((p) => p.status === "APPROVED")) {
    const methodCode = resolveMethodCode(row);
    let bucket = "P2P";
    if (methodCode === "VIRTUAL_BANK_ACCOUNT_DYNAMIC") bucket = "IDR_VA_DYNAMIC";
    if (methodCode === "VIRTUAL_BANK_ACCOUNT_STATIC") bucket = "IDR_VA_STATIC";
    if (methodCode === "FAZZ_SEND") bucket = "IDR_SEND";
    if (methodCode === AUD_NPP_CODE) {
      const details = row?.detailsJson as Prisma.JsonObject | null;
      const rail = String((details && (details as any).rail) || "").trim().toUpperCase();
      bucket = rail === "PAYID" ? "AUD_NPP_PAYID" : "AUD_NPP_BANK";
    }
    const current = methodBreakdownMap.get(bucket) || { method: bucket, approvedSumCents: 0, approvedCount: 0 };
    current.approvedSumCents += row.amountCents || 0;
    current.approvedCount += 1;
    methodBreakdownMap.set(bucket, current);
  }

  const lifetimeRows = await prisma.providerPayment.findMany({
    where: {
      provider: "FAZZ",
      expiresAt: { not: null },
      createdAt: { gte: from, lte: to },
      ...(merchantIds.length ? { paymentRequest: { merchantId: { in: merchantIds } } } : {}),
    },
    select: { createdAt: true, expiresAt: true },
  });
  const lifetimeDurations = lifetimeRows
    .map((row) => (row.expiresAt ? row.expiresAt.getTime() - row.createdAt.getTime() : null))
    .filter((v): v is number => typeof v === "number" && v > 0);
  const avgVaLifetimeMs = lifetimeDurations.length
    ? Math.round(lifetimeDurations.reduce((a, b) => a + b, 0) / lifetimeDurations.length)
    : 0;

  const rejectReasons = Array.from(rejectReasonsMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }));

  return {
    filters: {
      from: from.toISOString(),
      to: to.toISOString(),
      tz,
      merchantIds,
      methods: methodFilters,
    },
    kpi: {
      kyc: {
        starts: kycStarts,
        completes: kycCompletes,
        completionRate: kycStarts ? kycCompletes / kycStarts : 0,
        avgTimeToApprovalMs,
      },
      deposits: {
        vaCreateAttemptCount: vaAttempts,
        vaCreateSuccessCount: vaCreates,
        vaCreateSuccessRate: vaAttempts ? vaCreates / vaAttempts : 0,
        approvedCount: approvedDeposits.length,
        approvedSumCents: approvedDeposits.reduce((sum, p) => sum + p.amountCents, 0),
        rejectedCount: rejectedDeposits.length,
        rejectedSumCents: rejectedDeposits.reduce((sum, p) => sum + p.amountCents, 0),
      },
      withdrawals: {
        submittedCount: withdrawalRows.filter((p) => p.status === "SUBMITTED").length,
        approvedCount: approvedWithdrawals.length,
        approvedSumCents: approvedWithdrawals.reduce((sum, p) => sum + p.amountCents, 0),
        rejectedCount: rejectedWithdrawals.length,
        rejectedSumCents: rejectedWithdrawals.reduce((sum, p) => sum + p.amountCents, 0),
      },
    },
    series: {
      kyc: Object.values(seriesKyc),
      deposits: Object.values(seriesDeposits),
      withdrawals: Object.values(seriesWithdrawals),
    },
    breakdown: {
      byMethod: Array.from(methodBreakdownMap.values()),
      rejectReasons,
      avgVaLifetimeMs,
      avgProviderResponseMs: null,
    },
  };
}

export async function getMetricsTimeseries(filters: MetricsFilters) {
  const overview = await getMetricsOverview(filters);
  return {
    filters: overview.filters,
    series: overview.series,
  };
}
