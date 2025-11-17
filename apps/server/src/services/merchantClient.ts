import { prisma } from "../lib/prisma.js";

export type MerchantClientParams = {
  merchantId: string;
  userId: string;
  diditSubject: string;
  externalId?: string | null;
  email?: string | null;
};

export async function upsertMerchantClientMapping({
  merchantId,
  userId,
  diditSubject,
  externalId,
  email,
}: MerchantClientParams) {
  const ext = (externalId && String(externalId).trim()) || diditSubject;
  if (!merchantId || !userId || !diditSubject || !ext) return;

  try {
    await prisma.merchantClient.upsert({
      where: { diditSubject },
      create: {
        merchantId,
        externalId: ext,
        userId,
        diditSubject,
        email: email || null,
      },
      update: {
        merchantId,
        externalId: ext,
        userId,
        email: email || null,
      },
    });
  } catch (err) {
    console.error("merchantClient upsert failed", err);
  }
}
