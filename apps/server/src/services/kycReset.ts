import { prisma } from "../lib/prisma.js";

type KycResetParams = {
  merchantId: string;
  userId: string;
  diditSubject?: string | null;
  requestedByAdminId?: string | null;
  reason?: string | null;
};

export async function requestKycReverify(params: KycResetParams) {
  const { merchantId, userId, diditSubject, requestedByAdminId, reason } = params;
  const existing = await prisma.kycReverifyRequest.findFirst({
    where: { merchantId, userId, clearedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;

  return prisma.kycReverifyRequest.create({
    data: {
      merchantId,
      userId,
      diditSubject: diditSubject ?? null,
      requestedByAdminId: requestedByAdminId ?? null,
      reason: reason ?? null,
    },
  });
}

export async function clearKycReverify(params: { merchantId: string; userId: string }) {
  const { merchantId, userId } = params;
  const now = new Date();
  await prisma.kycReverifyRequest.updateMany({
    where: { merchantId, userId, clearedAt: null },
    data: { clearedAt: now },
  });
  return { clearedAt: now };
}

export async function hasOpenKycReverify(params: { merchantId: string; userId: string }) {
  const { merchantId, userId } = params;
  const count = await prisma.kycReverifyRequest.count({
    where: { merchantId, userId, clearedAt: null },
  });
  return count > 0;
}
