import { prisma } from "../apps/server/src/lib/prisma.js";

async function main() {
  const reqs = await prisma.paymentRequest.findMany({
    select: {
      merchantId: true,
      userId: true,
      user: { select: { diditSubject: true, email: true } },
    },
    where: { userId: { not: null } },
  });

  const seen = new Set<string>();
  for (const pr of reqs) {
    const key = `${pr.merchantId}:${pr.userId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const diditSubject = pr.user?.diditSubject;
    if (!diditSubject) continue;

    await prisma.merchantClient.upsert({
      where: { diditSubject },
      create: {
        merchantId: pr.merchantId,
        externalId: diditSubject,
        userId: pr.userId,
        diditSubject,
        email: pr.user?.email || null,
      },
      update: {
        merchantId: pr.merchantId,
        userId: pr.userId,
        email: pr.user?.email || null,
      },
    });
  }

  console.log("Backfill complete");
}

main().finally(() => prisma.$disconnect());
