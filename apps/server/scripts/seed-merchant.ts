// apps/server/scripts/seed-merchant.ts
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const demoId = process.env.MERCHANT_DEMO_ID!;
  const demoEmail = process.env.MERCHANT_DEMO_EMAIL || "merchant@example.com";
  const name = "Demo Merchant";

  if (!demoId) throw new Error("MERCHANT_DEMO_ID not set in .env");

  // If a merchant with this id exists, keep it; else create it with that id.
  const existing = await prisma.merchant.findUnique({ where: { id: demoId } });
  if (existing) {
    console.log("Merchant already exists:", existing.id, existing.name);
    return;
  }

  // Minimal fields per your schema; adjust defaults as you like
  const m = await prisma.merchant.create({
    data: {
      id: demoId,               // force the given ID
      name,
      email: demoEmail,
      defaultCurrency: "IDR",
      active: true,
      status: "active",
      apiKeysSelfServiceEnabled: true,
      userDirectoryEnabled: false,
    },
  });

  console.log("Created merchant:", m.id, m.name);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
