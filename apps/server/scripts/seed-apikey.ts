// apps/server/scripts/seed-apikey.ts
import { prisma } from "../src/lib/prisma.js";
import { randomBytes } from "node:crypto";
import { seal } from "../src/services/secretBox.js";
import { API_KEY_SCOPES } from "../src/services/apiKeyScopes.js";

function randBase36(n: number) {
  return randomBytes(n).toString("base64url").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, n);
}

async function getMerchantId(): Promise<string> {
  const envId = process.env.MERCHANT_DEMO_ID?.trim();
  if (envId) {
    const exists = await prisma.merchant.findUnique({ where: { id: envId } });
    if (exists) return envId;
    console.warn("[seed-apikey] MERCHANT_DEMO_ID set but not found in DB:", envId);
  }
  const first = await prisma.merchant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!first) throw new Error("No merchants found. Create one first.");
  console.warn("[seed-apikey] Using first merchant:", first.id, first.name);
  return first.id;
}

async function main() {
  const merchantId = await getMerchantId();

  const prefix = randBase36(8);
  const secret = randBase36(32);

  const secretEnc = seal(secret);
  const last4 = secret.slice(-4);

  const key = await prisma.merchantApiKey.create({
    data: {
      merchantId,
      prefix,
      secretEnc,
      last4,
      scopes: [API_KEY_SCOPES.P2P, API_KEY_SCOPES.IDRV4_ACCEPT, API_KEY_SCOPES.IDRV4_DISBURSE],
      active: true,
    },
  });

  console.log("API key created:");
  console.log("  prefix:", key.prefix);
  console.log("  secret:", secret);
  console.log("Use header:");
  console.log(`  Authorization: Bearer ${key.prefix}.${secret}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
