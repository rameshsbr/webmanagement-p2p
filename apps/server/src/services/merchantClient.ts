import { prisma } from "../lib/prisma.js";

export type ClientStatus = "ACTIVE" | "DEACTIVATED" | "BLOCKED";
export const CLIENT_STATUS_VALUES: ClientStatus[] = ["ACTIVE", "DEACTIVATED", "BLOCKED"];
export const clientStatusLabel: Record<ClientStatus, string> = {
  ACTIVE: "Active",
  DEACTIVATED: "Deactivated",
  BLOCKED: "Blocked",
};

export function normalizeClientStatus(input?: string | null): ClientStatus {
  const normalized = String(input || "ACTIVE").toUpperCase();
  if (normalized === "DEACTIVATED") return "DEACTIVATED";
  if (normalized === "BLOCKED") return "BLOCKED";
  return "ACTIVE";
}

export function formatClientStatusLabel(input?: string | null): string {
  const status = normalizeClientStatus(input);
  return clientStatusLabel[status];
}

/**
 * Concurrency-safe upsert for MerchantClient.
 * Handles P2002 races that can occur when two requests attempt to create
 * the same (merchantId,userId) or (merchantId,externalId) simultaneously.
 *
 * ⚠️ Only behavior change is robustness under contention; logic & selected fields stay the same.
 */
export async function upsertMerchantClientMapping(params: {
  merchantId: string;
  userId: string;
  externalId?: string | null;
  email?: string | null;
}) {
  const { merchantId, userId, externalId, email } = params;

  // Helper to keep selection identical everywhere
  const selectFields = { merchantId: true, userId: true, status: true } as const;

  if (externalId) {
    try {
      return await prisma.merchantClient.upsert({
        where: { merchantId_externalId: { merchantId, externalId } },
        create: { merchantId, userId, externalId, email: email ?? null, status: "ACTIVE" },
        update: { userId, email: email ?? null },
        select: selectFields,
      });
    } catch (e: any) {
      // If a concurrent request won the race, fall back to updating.
      if (e?.code === "P2002") {
        try {
          return await prisma.merchantClient.update({
            where: { merchantId_externalId: { merchantId, externalId } },
            data: { userId, email: email ?? null },
            select: selectFields,
          });
        } catch (ue: any) {
          // If the record still isn't found by externalId, try by (merchantId,userId)
          if (ue?.code === "P2025") {
            return await prisma.merchantClient.update({
              where: { merchantId_userId: { merchantId, userId } },
              data: { email: email ?? null },
              select: selectFields,
            });
          }
          throw ue;
        }
      }
      throw e;
    }
  }

  // No externalId path
  try {
    return await prisma.merchantClient.upsert({
      where: { merchantId_userId: { merchantId, userId } },
      create: { merchantId, userId, externalId: null, email: email ?? null, status: "ACTIVE" },
      update: { email: email ?? null },
      select: selectFields,
    });
  } catch (e: any) {
    if (e?.code === "P2002") {
      // Another request created it first; just update in place.
      return await prisma.merchantClient.update({
        where: { merchantId_userId: { merchantId, userId } },
        data: { email: email ?? null },
        select: selectFields,
      });
    }
    throw e;
  }
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