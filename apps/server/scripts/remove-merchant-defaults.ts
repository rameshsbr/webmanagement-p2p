import { prisma } from "../src/lib/prisma.js";

async function main() {
  console.log("[cleanup] Removing merchant default configs…");

  const removedFormConfigs = await prisma.merchantFormConfig.deleteMany({
    where: { bankAccountId: null },
  });

  const removedBanks = await prisma.bankAccount.deleteMany({
    where: {
      OR: [
        { label: { contains: "Merchant default", mode: "insensitive" } },
        { bankName: { contains: "Merchant default", mode: "insensitive" } },
      ],
    },
  });

  console.log(
    `[cleanup] Deleted ${removedBanks.count} bank accounts and ${removedFormConfigs.count} form configs tagged as merchant defaults.`
  );
}

main()
  .catch((err) => {
    console.error("[cleanup] Failed to remove merchant defaults", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
