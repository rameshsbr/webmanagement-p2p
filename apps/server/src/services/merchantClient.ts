import { prisma } from "../lib/prisma.js";

export const CLIENT_STATUS_VALUES = ["ACTIVE", "DEACTIVATED", "BLOCKED"] as const;
export type ClientStatus = (typeof CLIENT_STATUS_VALUES)[number];

export function normalizeClientStatus(value?: string | null): ClientStatus {
  const upper = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (CLIENT_STATUS_VALUES.includes(upper as ClientStatus)) return upper as ClientStatus;
  return "ACTIVE";
}

export function clientStatusLabel(status: ClientStatus): string {
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
    const mapping = await prisma.merchantClient.upsert({
      where: { merchantId_externalId: { merchantId, externalId } },
      create: { merchantId, userId, externalId, email: email ?? null, status: "ACTIVE" },
      update: { userId, email: email ?? null },
      select: { id: true, status: true },
    });
    return mapping;
  }

  const mapping = await prisma.merchantClient.upsert({
    where: { merchantId_userId: { merchantId, userId } },
    create: { merchantId, userId, externalId: null, email: email ?? null, status: "ACTIVE" },
    update: { email: email ?? null },
    select: { id: true, status: true },
  });

  return mapping;
}

export async function getMerchantClientStatus(merchantId: string, userId: string) {
  const mapping = await prisma.merchantClient.findUnique({
    where: { merchantId_userId: { merchantId, userId } },
    select: { id: true, status: true },
  });
  return { id: mapping?.id || null, status: normalizeClientStatus(mapping?.status) };
}
