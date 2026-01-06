import { prisma } from "../src/lib/prisma.js";

async function getMerchantId(): Promise<string> {
  const envId = process.env.MERCHANT_DEMO_ID?.trim();
  if (envId) {
    const found = await prisma.merchant.findUnique({ where: { id: envId } });
    if (found) return envId;
    console.warn("[seed-bankaccounts] MERCHANT_DEMO_ID set but not found:", envId);
  }
  const first = await prisma.merchant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!first) throw new Error("No merchants found. Create one first.");
  console.warn("[seed-bankaccounts] Using first merchant:", first.id, first.name);
  return first.id;
}

async function upsertTemplate(merchantId: string, method: string, label: string) {
  const row = await prisma.bankAccount.findFirst({
    where: { merchantId, currency: "IDR", method, active: true },
  });
  if (row) {
    console.log("Already exists:", method, "→", row.id);
    return row;
  }
  const created = await prisma.bankAccount.create({
    data: {
      merchantId,
      currency: "IDR",
      holderName: label,          // display only; real VA holder comes from Fazz/Didit
      bankName: "Fazz VA",
      accountNo: "-",             // placeholder; dynamic VA will override per intent
      method,                     // IMPORTANT: must match Method.code
      label,
      active: true,
      fields: {
        core: {
          holderName: { visible: true },
          bankName:   { visible: true },
          accountNo:  { visible: true },
          iban:       { visible: false },
        },
        extra: [],
      },
    },
    select: { id: true },
  });
  console.log("Created template:", method, "→", created.id);
  return created;
}

async function main() {
  const merchantId = await getMerchantId();

  await upsertTemplate(merchantId, "VIRTUAL_BANK_ACCOUNT_DYNAMIC", "ID VA – Dynamic (Fazz)");
  await upsertTemplate(merchantId, "VIRTUAL_BANK_ACCOUNT_STATIC",  "ID VA – Static (Fazz)");

  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
