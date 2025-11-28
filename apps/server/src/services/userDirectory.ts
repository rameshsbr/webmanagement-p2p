import { PaymentStatus, PaymentType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { fetchDiditProfile } from "./didit.js";
import { normalizeClientStatus, formatClientStatusLabel, type ClientStatus } from "./merchantClient.js";

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
  fullName: string | null;
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

  /** true when manual name and Didit name differ significantly */
  nameMismatchWarning?: boolean;
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

/**
 * Very simple token-based similarity for names.
 * Returns 0–1, where 1 = all words match (order doesn’t matter).
 */
function normalizeNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function computeNameSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const tokensA = new Set(normalizeNameTokens(a));
  const tokensB = new Set(normalizeNameTokens(b));
  if (!tokensA.size || !tokensB.size) return 0;

  let intersection = 0;
  tokensA.forEach((t) => {
    if (tokensB.has(t)) intersection += 1;
  });

  // Sørensen–Dice on tokens
  return (2 * intersection) / (tokensA.size + tokensB.size);
}

function computeStatus(verifiedAt: Date | null, latestKyc: string | null): string {
  if (verifiedAt) return "Verified";
  if (!latestKyc) return "Pending";
  const norm = latestKyc.toLowerCase();
  if (norm.includes("reject")) return "Rejected";
  if (norm.includes("approve") || norm.includes("complete")) return "Verified";
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

  const totals = new Map<string, { deposits: number; withdrawals: number }>();

  paymentCounts.forEach((row) => {
    if (!row.userId) return;
    const key = `${row.userId}:${row.merchantId}`;
    const current = totals.get(key) || { deposits: 0, withdrawals: 0 };
    if (row.type === PaymentType.DEPOSIT) current.deposits = row._count._all;
    else if (row.type === PaymentType.WITHDRAWAL) current.withdrawals = row._count._all;
    totals.set(key, current);
  });

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
    const payments = user?.paymentReqs ?? [];
    const latestPayment = payments[0] || null;
    const details = latestPayment?.detailsJson || {};

    // 1) Manual name from payment (payer / account holder field)
    const manualName = computeFullName(details);

    // 2) Name from Didit profile (if any)
    const profile = diditProfiles[index];
    const diditName = profile?.fullName ? profile.fullName.trim() : null;

    // 3) Decide which name to display + whether to flag mismatch
    let fullName: string | null = manualName || diditName || null;
    let nameMismatchWarning = false;

    if (diditName) {
      if (!manualName) {
        // Only Didit name available → use it
        fullName = diditName;
      } else {
        const similarity = computeNameSimilarity(manualName, diditName);
        if (similarity < 0.8) {
          // < 80% similar → override with Didit + show warning
          fullName = diditName;
          nameMismatchWarning = true;
        } else {
          // Names close enough → keep the payer-typed name
          fullName = manualName;
        }
      }
    }

    const latestKycRow = user?.kyc && user.kyc.length ? user.kyc[0] : null;
    const latestKycStatus = latestKycRow?.status || null;
    const latestSessionId = latestKycRow?.externalSessionId || null;
    const verificationStatus = computeStatus(user?.verifiedAt ?? null, latestKycStatus);

    const merchants: Array<{ id: string; name: string }> = [
      { id: client.merchantId, name: merchantMap.get(client.merchantId) || client.merchantId },
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
      fullName,
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

      latestSessionId,
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
    lines.push(`${user.publicId} • ${user.fullName || "—"}`);
    lines.push(`External ID: ${user.externalId || "—"}`);
    lines.push(`Email: ${user.email || "—"} | Phone: ${user.phone || "—"}`);
    lines.push(`Client status: ${formatClientStatusLabel(user.clientStatus)}`);
    lines.push(`Status: ${user.verificationStatus}`);
    if (user.latestSessionId) {
      lines.push(`Latest session ID: ${user.latestSessionId}`);
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

  const parts: string[] = ['%PDF-1.4\n'];
  const offsets: number[] = [];
  offsets[0] = 0;
  let offset = Buffer.byteLength(parts[0], 'utf8');

  objects.forEach((obj) => {
    offsets[obj.index] = offset;
    const chunk = `${obj.index} 0 obj\n${obj.body}\nendobj\n`;
    parts.push(chunk);
    offset += Buffer.byteLength(chunk, 'utf8');
  });

  const xrefStart = offset;
  const maxIndex = fontIndex;
  parts.push(`xref\n0 ${maxIndex + 1}\n`);
  parts.push('0000000000 65535 f \n');
  for (let i = 1; i <= maxIndex; i += 1) {
    const pos = offsets[i] ?? offset;
    parts.push(`${pos.toString().padStart(10, '0')} 00000 n \n`);
  }
  parts.push(`trailer\n<< /Size ${maxIndex + 1} /Root ${catalogIndex} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return Buffer.from(parts.join(''));
}