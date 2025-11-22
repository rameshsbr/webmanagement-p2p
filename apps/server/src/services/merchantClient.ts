import { prisma } from "../lib/prisma.js";

export type ClientStatus = "ACTIVE" | "DEACTIVATED" | "BLOCKED";

export function normalizeClientStatus(input?: string | null): ClientStatus {
  const normalized = String(input || "ACTIVE").toUpperCase();
  if (normalized === "DEACTIVATED") return "DEACTIVATED";
  if (normalized === "BLOCKED") return "BLOCKED";
  return "ACTIVE";
}

export function formatClientStatusLabel(input?: string | null): string {
  const status = normalizeClientStatus(input);
  if (status === "DEACTIVATED") return "Deactivated";
  if (status === "BLOCKED") return "Blocked";
  return "Active";
}

export async function upsertMerchantClientMapping(params: {
  merchantId: string;
  userId: string;
  externalId?: string | null;
  email?: string | null;
}) {
  const { merchantId, userId, externalId, email } = params;

  if (externalId) {
    return prisma.merchantClient.upsert({
      where: { merchantId_externalId: { merchantId, externalId } },
      create: { merchantId, userId, externalId, email: email ?? null, status: "ACTIVE" },
      update: { userId, email: email ?? null },
      select: { merchantId: true, userId: true, status: true },
    });
  }

  return prisma.merchantClient.upsert({
    where: { merchantId_userId: { merchantId, userId } },
    create: { merchantId, userId, externalId: null, email: email ?? null, status: "ACTIVE" },
    update: { email: email ?? null },
    select: { merchantId: true, userId: true, status: true },
  });
  return { id: mapping?.id || null, status: normalizeClientStatus(mapping?.status) };
}

export async function getMerchantClientStatus(merchantId: string, userId: string): Promise<ClientStatus> {
  const rec = await prisma.merchantClient.findUnique({
    where: { merchantId_userId: { merchantId, userId } },
    select: { status: true },
  });
  return normalizeClientStatus(rec?.status);
}

export async function getClientStatusBySubject(merchantId: string, diditSubject: string): Promise<ClientStatus> {
  const user = await prisma.user.findUnique({ where: { diditSubject }, select: { id: true } });
  if (!user?.id) return "ACTIVE";
  return getMerchantClientStatus(merchantId, user.id);
}
