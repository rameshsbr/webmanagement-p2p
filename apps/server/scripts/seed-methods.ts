// apps/server/scripts/seed-methods.ts
import { prisma } from "../src/lib/prisma.js";

async function upsertMethod(code: string, name: string, merchantId: string) {
  const m = await prisma.method.upsert({
    where: { code },
    update: { name, enabled: true },
    create: { code, name, enabled: true },
  });
  await prisma.merchantMethod.upsert({
    where: { merchantId_methodId: { merchantId, methodId: m.id } },
    update: { enabled: true },
    create: { merchantId, methodId: m.id, enabled: true },
  });
  console.log("Enabled method for merchant:", code);
}

async function main() {
  const merchantId = process.env.MERCHANT_DEMO_ID!;
  if (!merchantId) throw new Error("MERCHANT_DEMO_ID not set in .env");

  await upsertMethod("VIRTUAL_BANK_ACCOUNT_DYNAMIC", "ID VA – Dynamic", merchantId);
  await upsertMethod("VIRTUAL_BANK_ACCOUNT_STATIC",  "ID VA – Static", merchantId);

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
