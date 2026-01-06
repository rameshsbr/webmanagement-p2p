// apps/server/scripts/seed-methods.ts
import { prisma } from "../src/lib/prisma.js";

async function getMerchantId(): Promise<string> {
  // Prefer .env
  const envId = process.env.MERCHANT_DEMO_ID?.trim();
  if (envId) {
    const exists = await prisma.merchant.findUnique({ where: { id: envId } });
    if (exists) return envId;
    console.warn("[seed-methods] MERCHANT_DEMO_ID set but not found in DB:", envId);
  }
  // Fallback: first merchant in DB
  const first = await prisma.merchant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!first) throw new Error("No merchants found. Create one first.");
  console.warn("[seed-methods] Using first merchant:", first.id, first.name);
  return first.id;
}

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
  const merchantId = await getMerchantId();

  await upsertMethod("VIRTUAL_BANK_ACCOUNT_DYNAMIC", "ID VA – Dynamic", merchantId);
  await upsertMethod("VIRTUAL_BANK_ACCOUNT_STATIC",  "ID VA – Static", merchantId);

  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
