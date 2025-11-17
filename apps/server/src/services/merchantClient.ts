import { prisma } from "../lib/prisma.js";

export async function upsertMerchantClientMapping(params: {
  merchantId: string;
  userId: string;
  diditSubject: string;
  externalId?: string | null;
  email?: string | null;
}) {
  const { merchantId, userId, diditSubject, externalId, email } = params;
  const ext = externalId || diditSubject;

  await prisma.merchantClientMapping
    .upsert({
      where: { diditSubject },
      create: { merchantId, externalId: ext, userId, diditSubject, email: email || null },
      update: { merchantId, externalId: ext, userId, email: email || null },
    })
    .catch(() => {});
}
