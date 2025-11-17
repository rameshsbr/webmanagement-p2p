import { prisma } from "../apps/server/src/lib/prisma.js";

async function main() {
  const payments = await prisma.paymentRequest.findMany({
    select: {
      merchantId: true,
      userId: true,
      user: { select: { diditSubject: true } },
    },
    where: { userId: { not: null } },
  });

  const seen = new Set<string>();
  for (const row of payments) {
    if (!row.userId || !row.merchantId) continue;
    const key = `${row.merchantId}:${row.userId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const diditSubject = row.user?.diditSubject;
    if (!diditSubject) continue;

    await prisma.merchantClient.upsert({
      where: { diditSubject },
      create: {
        merchantId: row.merchantId,
        externalId: diditSubject,
        userId: row.userId,
        diditSubject,
      },
      update: {
        merchantId: row.merchantId,
        userId: row.userId,
      },
    });
  }

  console.log("Backfill complete");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
