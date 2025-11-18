import { prisma } from "../lib/prisma.js";

export async function upsertMerchantClientMapping(params: {
  merchantId: string;
  userId: string;
  externalId?: string | null;
  email?: string | null;
}) {
  const { merchantId, userId, externalId, email } = params;

  if (externalId) {
    await prisma.merchantClient.upsert({
      where: { merchantId_externalId: { merchantId, externalId } },
      create: { merchantId, userId, externalId, email: email ?? null },
      update: { userId, email: email ?? null },
    });
    return;
  }

  await prisma.merchantClient.upsert({
    where: { merchantId_userId: { merchantId, userId } },
    create: { merchantId, userId, externalId: null, email: email ?? null },
    update: { email: email ?? null },
  });
}
