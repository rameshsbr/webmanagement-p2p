import { PaymentStatus, PaymentType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { fetchDiditProfile } from "./didit.js";
import { normalizeClientStatus, formatClientStatusLabel, type ClientStatus } from "./merchantClient.js";
import { evaluateNameMatch } from "./paymentStatus.js";

export type UserDirectoryFilters = {
  merchantIds?: string[];
  search?: string | null;
  page?: number | string | null;
  perPage?: number | string | null;
};

export type UserDirectoryItem = {
  id: string;
  externalId: string | null;
  publicId: string;
  merchantId: string;
  email: string | null;
  phone: string | null;
  diditSubject: string;

  // NEW: split name
  firstName: string | null;
  lastName: string | null;

  // Still keep fullName for exports / backwards compatibility
  fullName: string | null;

  // NEW: KYC profile fields from Didit
  documentType: string | null;
  documentNumber: string | null;
  documentIssuingState: string | null;
  documentIssuingCountry: string | null;
  dateOfBirth: Date | null;
  documentExpiry: Date | null;
  gender: string | null;
  address: string | null;

  registeredAt: Date;
  verifiedAt: Date | null;
  clientStatus: ClientStatus;
  verificationStatus: string;
  accountStatus: ClientStatus;
  accountStatusLabel: string;
  merchantClientId: string | null;
  merchants: Array<{ id: string; name: string }>;
  lastActivityAt: Date | null;
  totalApprovedDeposits: number;
  totalApprovedWithdrawals: number;
  diditProfile?: DiditProfile | null;
  latestSessionId?: string | null;
  kycResetOpen?: boolean;

  /** true when manual name and Didit name differ significantly */
  nameMismatchWarning?: boolean;
  nameHardMismatch?: boolean;
  nameMatchScore?: number;
};

export type UserDirectoryResult = {
  total: number;
  page: number;
  perPage: number;
  pages: number;
  items: UserDirectoryItem[];
};

type DiditProfile = {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string | null;
};

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 250;

function normalizePagination(
  pageRaw: number | string | null | undefined,
  perPageRaw: number | string | null | undefined
) {
  const pageNum = Number(pageRaw);
  const perPageNum = Number(perPageRaw);
  const page = Number.isFinite(pageNum) && pageNum > 0 ? Math.floor(pageNum) : DEFAULT_PAGE;
  const perPage = Number.isFinite(perPageNum) && perPageNum > 0
    ? Math.min(MAX_PER_PAGE, Math.max(5, Math.floor(perPageNum)))
    : DEFAULT_PER_PAGE;
  return { page, perPage };
}

/**
 * Pull a name from the payment request JSON (payer / destination / extras).
 */
function computeFullName(candidate: any): string | null {
  if (!candidate) return null;
  const payer = candidate?.payer || {};
  const destination = candidate?.destination || {};
  const extras = candidate?.extras || {};
  const names = [
    payer.holderName,
    destination.holderName,
    extras["Account holder name"],
    extras["Full name"],
  ].map((v: any) => (typeof v === "string" ? v.trim() : ""));
  const name = names.find((n) => n.length > 1);
  return name || null;
}

function computeStatus(verifiedAt: Date | null, latestKyc: string | null, approvedCount: number): string {
  if (!latestKyc) return "Pending";
  const norm = latestKyc.toLowerCase();
  if (norm.includes("reject")) return "Rejected";
  if (norm.includes("approve") || norm.includes("complete")) {
    if (approvedCount >= 2) return "Re-verified";
    return "Verified";
  }
  if (verifiedAt) return "Verified";
  return "Pending";
}

export async function getUserDirectory(filters: UserDirectoryFilters): Promise<UserDirectoryResult> {
  const { page, perPage } = normalizePagination(filters.page, filters.perPage);
  const skip = (page - 1) * perPage;

  const merchantIds = Array.isArray(filters.merchantIds)
    ? filters.merchantIds.filter((id) => typeof id === "string" && id.trim().length)
    : [];

  if (merchantIds.length === 0) {
    return { total: 0, page, perPage, pages: 1, items: [] };
  }

  const where: any = { merchantId: { in: merchantIds } };

  const search = typeof filters.search === "string" ? filters.search.trim() : "";
  if (search) {
    const searchFilter = {
      OR: [
        { externalId: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        {
          user: {
            OR: [
              { diditSubject: { contains: search, mode: "insensitive" } },
              { publicId: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { phone: { contains: search, mode: "insensitive" } },
              {
                paymentReqs: {
                  some: {
                    OR: [
                      { detailsJson: { path: ["payer", "holderName"], string_contains: search } },
                      { detailsJson: { path: ["destination", "holderName"], string_contains: search } },
                    ],
                    merchantId: { in: merchantIds },
                  },
                },
              },
            ],
          },
        },
      ],
    };
    where.AND = Array.isArray(where.AND) ? [...where.AND, searchFilter] : [searchFilter];
  }

  const [total, clients] = await Promise.all([
    prisma.merchantClient.count({ where }),
    prisma.merchantClient.findMany({
      where,
      select: {
        id: true,
        merchantId: true,
        externalId: true,
        email: true,
        status: true,
        updatedAt: true,
        merchant: { select: { id: true, name: true } },
        user: {
          select: {
            id: true,
            publicId: true,
            email: true,
            phone: true,
            diditSubject: true,
            verifiedAt: true,
            createdAt: true,

            // NEW fields from Prisma User:
            fullName: true,
            firstName: true,
            lastName: true,
            documentType: true,
            documentNumber: true,
            documentIssuingState: true,
            documentIssuingCountry: true,
            dateOfBirth: true,
            documentExpiry: true,
            gender: true,
            address: true,

            paymentReqs: {
              where: { merchantId: { in: merchantIds } },
              select: { merchantId: true, createdAt: true, detailsJson: true },
              orderBy: { createdAt: "desc" },
              take: 5,
            },
            kyc: {
              select: { status: true, createdAt: true, externalSessionId: true },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: perPage,
    }),
  ]);

  const userIds = clients.map((row) => row.user?.id).filter(Boolean) as string[];

  const paymentCounts = userIds.length
    ? await prisma.paymentRequest.groupBy({
        where: {
          status: PaymentStatus.APPROVED,
          userId: { in: userIds },
          merchantId: { in: merchantIds },
        },
        by: ["userId", "merchantId", "type"],
        _count: { _all: true },
      })
    : [];

  const approvedKycCounts = userIds.length
    ? await prisma.kycVerification.groupBy({
        where: { userId: { in: userIds }, status: "approved" },
        by: ["userId"],
        _count: { _all: true },
      })
    : [];

  const openResets = userIds.length
    ? await prisma.kycReverifyRequest.findMany({
        where: { merchantId: { in: merchantIds }, userId: { in: userIds }, clearedAt: null },
        select: { merchantId: true, userId: true },
      })
    : [];

  const totals = new Map<string, { deposits: number; withdrawals: number }>();

  paymentCounts.forEach((row) => {
    if (!row.userId) return;
    const key = `${row.userId}:${row.merchantId}`;
    const current = totals.get(key) || { deposits: 0, withdrawals: 0 };
    if (row.type === PaymentType.DEPOSIT) current.deposits = row._count._all;
    else if (row.type === PaymentType.WITHDRAWAL) current.withdrawals = row._count._all;
    totals.set(key, current);
  });

  const kycApprovedCountMap = new Map<string, number>();
  approvedKycCounts.forEach((row) => {
    kycApprovedCountMap.set(row.userId, row._count._all);
  });

  const kycResetMap = new Set(openResets.map((row) => `${row.merchantId}:${row.userId}`));

  const merchantMap = new Map<string, string>();
  clients.forEach((row) => {
    merchantMap.set(row.merchantId, row.merchant?.name || row.merchantId);
  });

  const shouldFetchDidit = Boolean(
    process.env.DIDIT_CLIENT_ID ||
    process.env.DIDIT_CLIENT_SECRET ||
    process.env.DIDIT_API_KEY ||
    process.env.DIDIT_ACCESS_TOKEN
  );

  const diditProfiles: Array<DiditProfile | null> = shouldFetchDidit
    ? await Promise.all(
        clients.map(async (client) => {
          try {
            return client.user?.diditSubject
              ? await fetchDiditProfile(client.user.diditSubject)
              : null;
          } catch {
            return null;
          }
        })
      )
    : clients.map(() => null);

  const items: UserDirectoryItem[] = clients.map((client, index) => {
    const user = client.user;
    const profile = diditProfiles[index];

    const payments = user?.paymentReqs ?? [];
    const latestPayment = payments[0] || null;
    const details = latestPayment?.detailsJson || {};

    //
    // 1) Get REAL name from DB (updated by Didit webhook)
    //
    const dbFullName = user?.fullName ? user.fullName.trim() : null;
    const dbFirstName = user?.firstName ? user.firstName.trim() : null;
    const dbLastName = user?.lastName ? user.lastName.trim() : null;

    //
    // 2) Extract any manual / payer-entered name from latest deposit
    //
    const manualName = computeFullName(details);

    //
    // 3) Compute mismatch (but NEVER override DB name)
    //
    const match = evaluateNameMatch(manualName, dbFirstName, dbLastName, dbFullName);
    const nameMismatchWarning = match.needsReview;
    const nameHardMismatch = !match.allow;
    const nameMatchScore = match.score;

    //
    // 4) Full name shown in exports = DB first+last OR DB fullName
    //
    const fullName =
      dbFullName ||
      [dbFirstName, dbLastName].filter(Boolean).join(" ") ||
      manualName ||
      null;

    const latestKycRow = user?.kyc && user.kyc.length ? user.kyc[0] : null;
    const latestKycStatus = latestKycRow?.status || null;
    const latestSessionId = latestKycRow?.externalSessionId || null;
    const approvedCount = user?.id ? kycApprovedCountMap.get(user.id) || 0 : 0;
    const verificationStatus = computeStatus(
      user?.verifiedAt ?? null,
      latestKycStatus,
      approvedCount
    );

    const merchants: Array<{ id: string; name: string }> = [
      {
        id: client.merchantId,
        name: merchantMap.get(client.merchantId) || client.merchantId,
      },
    ];

    const key = user?.id ? `${user.id}:${client.merchantId}` : null;
    const counts = (key && totals.get(key)) || { deposits: 0, withdrawals: 0 };
    const clientStatus = normalizeClientStatus((client as any)?.status);
    const accountStatus = clientStatus;
    const accountStatusLabel = formatClientStatusLabel(accountStatus);

    return {
      id: user?.id ?? client.id,
      publicId: user?.publicId ?? client.id,
      externalId: client.externalId,
      merchantId: client.merchantId,
      email: client.email ?? user?.email ?? null,
      phone: user?.phone ?? null,
      diditSubject: user?.diditSubject ?? client.externalId ?? client.id,

      // NEW: pass through split names + fullName
      firstName: dbFirstName,
      lastName: dbLastName,
      fullName,

      // NEW: pass through KYC fields from Prisma User
      documentType: user?.documentType ?? null,
      documentNumber: user?.documentNumber ?? null,
      documentIssuingState: user?.documentIssuingState ?? null,
      documentIssuingCountry: user?.documentIssuingCountry ?? null,
      dateOfBirth: user?.dateOfBirth ?? null,
      documentExpiry: user?.documentExpiry ?? null,
      gender: user?.gender ?? null,
      address: user?.address ?? null,

      registeredAt: user?.createdAt ?? client.updatedAt ?? new Date(0),
      verifiedAt: user?.verifiedAt ?? null,
      clientStatus,
      verificationStatus,
      accountStatus,
      accountStatusLabel,
      merchantClientId: (client as any).id || null,
      merchants,
      lastActivityAt: latestPayment?.createdAt ?? client.updatedAt ?? null,
      totalApprovedDeposits: counts.deposits,
      totalApprovedWithdrawals: counts.withdrawals,
      diditProfile: profile,
      nameMismatchWarning,
      nameHardMismatch,
      nameMatchScore,
      latestSessionId,
      kycResetOpen: !!(user?.id && kycResetMap.has(`${client.merchantId}:${user.id}`)),
    };
  });

  const pages = Math.max(1, Math.ceil(total / perPage));
  return { total, page, perPage, pages, items };
}

export async function getAllUsers(filters: UserDirectoryFilters): Promise<UserDirectoryItem[]> {
  const merchantIds = Array.isArray(filters.merchantIds)
    ? filters.merchantIds.filter((id) => typeof id === "string" && id.trim().length)
    : [];
  if (!merchantIds.length) return [];
  const search = typeof filters.search === "string" ? filters.search.trim() : "";

  const results: UserDirectoryItem[] = [];
  let page = 1;
  while (true) {
    const chunk = await getUserDirectory({ merchantIds, search, page, perPage: MAX_PER_PAGE });
    results.push(...chunk.items);
    if (page >= chunk.pages) break;
    page += 1;
    if (page > 40) break; // guard against runaway exports
  }
  return results;
}

function escapePdfText(text: string): string {
  return text.replace(/[\\()]/g, (m) => `\\${m}`).replace(/\r?\n/g, " ");
}

function chunkLines(lines: string[], perPage: number): string[][] {
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += perPage) {
    pages.push(lines.slice(i, i + perPage));
  }
  return pages.length ? pages : [["No client records available."]];
}

function buildContentStream(lines: string[]): string {
  const body: string[] = [];
  body.push("BT");
  body.push("/F1 12 Tf");
  body.push("14 TL");
  body.push("72 760 Td");
  lines.forEach((line, idx) => {
    const escaped = escapePdfText(line);
    if (idx === 0) body.push(`(${escaped}) Tj`);
    else body.push("T*", `(${escaped}) Tj`);
  });
  body.push("ET");
  return body.join("\n");
}

export function renderUserDirectoryPdf(items: UserDirectoryItem[]): Buffer {
  const lines: string[] = [];
  const exportedAt = new Date().toISOString();
  lines.push(`Client directory export — ${exportedAt}`);
  lines.push("");

  if (!items.length) {
    lines.push("No client records available.");
  }

  items.forEach((user) => {
    const nameForExport =
      user.fullName ||
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      "—";

    lines.push(`${user.publicId} • ${nameForExport}`);
    lines.push(`External ID: ${user.externalId || "—"}`);
    lines.push(`Email: ${user.email || "—"} | Phone: ${user.phone || "—"}`);
    lines.push(`Client status: ${formatClientStatusLabel(user.clientStatus)}`);
    lines.push(`Status: ${user.verificationStatus}`);
    if (user.latestSessionId) {
      lines.push(`Latest session ID: ${user.latestSessionId}`);
    }

    // NEW: export KYC fields
    if (user.documentType || user.documentNumber) {
      lines.push(`Document: ${user.documentType || "Unknown"} ${user.documentNumber || ""}`.trim());
    }
    if (user.documentIssuingCountry || user.documentIssuingState) {
      lines.push(
        `Issuing: ${[user.documentIssuingCountry, user.documentIssuingState].filter(Boolean).join(", ")}`
      );
    }
    if (user.dateOfBirth) {
      lines.push(`Date of birth: ${user.dateOfBirth.toISOString().slice(0, 10)}`);
    }
    if (user.documentExpiry) {
      lines.push(`Document expiry: ${user.documentExpiry.toISOString().slice(0, 10)}`);
    }
    if (user.gender) {
      lines.push(`Gender: ${user.gender}`);
    }
    if (user.address) {
      lines.push(`Address: ${user.address}`);
    }

    lines.push(`Total approved deposits: ${user.totalApprovedDeposits}`);
    lines.push(`Total approved withdrawals: ${user.totalApprovedWithdrawals}`);
    lines.push(`Registered: ${user.registeredAt.toISOString()}`);
    if (user.lastActivityAt) {
      lines.push(`Last activity: ${user.lastActivityAt.toISOString()}`);
    }
    if (user.merchants.length) {
      lines.push(`Merchants: ${user.merchants.map((m) => m.name).join(", ")}`);
    }
    if (user.diditProfile) {
      if (user.diditProfile.email) lines.push(`Didit email: ${user.diditProfile.email}`);
      if (user.diditProfile.phone) lines.push(`Didit phone: ${user.diditProfile.phone}`);
      if (user.diditProfile.status) lines.push(`Didit status: ${user.diditProfile.status}`);
    }
    lines.push("");
  });

  const perPage = 40;
  const pages = chunkLines(lines, perPage);
  const objects: Array<{ index: number; body: string }> = [];

  const catalogIndex = 1;
  const pagesIndex = 2;
  const fontIndex = 3 + pages.length * 2;

  const kidRefs = pages.map((_, idx) => `${3 + idx * 2} 0 R`).join(" ");

  objects.push({ index: catalogIndex, body: `<< /Type /Catalog /Pages ${pagesIndex} 0 R >>` });
  objects.push({ index: pagesIndex, body: `<< /Type /Pages /Count ${pages.length} /Kids [${kidRefs}] >>` });

  pages.forEach((pageLines, idx) => {
    const pageIndex = 3 + idx * 2;
    const contentIndex = pageIndex + 1;
    const contentStream = buildContentStream(pageLines);
    const length = Buffer.byteLength(contentStream, "utf8");
    objects.push({
      index: pageIndex,
      body: `<< /Type /Page /Parent ${pagesIndex} 0 R /MediaBox [0 0 612 792] /Contents ${contentIndex} 0 R /Resources << /Font << /F1 ${fontIndex} 0 R >> >> >>`,
    });
    objects.push({
      index: contentIndex,
      body: `<< /Length ${length} >>\nstream\n${contentStream}\nendstream`,
    });
  });

  objects.push({ index: fontIndex, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" });

  objects.sort((a, b) => a.index - b.index);

  const parts: string[] = ["%PDF-1.4\n"];
  const offsets: number[] = [];
  offsets[0] = 0;
  let offset = Buffer.byteLength(parts[0], "utf8");

  objects.forEach((obj) => {
    offsets[obj.index] = offset;
    const chunk = `${obj.index} 0 obj\n${obj.body}\nendobj\n`;
    parts.push(chunk);
    offset += Buffer.byteLength(chunk, "utf8");
  });

  const xrefStart = offset;
  const maxIndex = fontIndex;
  parts.push(`xref\n0 ${maxIndex + 1}\n`);
  parts.push("0000000000 65535 f \n");
  for (let i = 1; i <= maxIndex; i += 1) {
    const pos = offsets[i] ?? offset;
    parts.push(`${pos.toString().padStart(10, "0")} 00000 n \n`);
  }
  parts.push(`trailer\n<< /Size ${maxIndex + 1} /Root ${catalogIndex} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return Buffer.from(parts.join(""));
}
