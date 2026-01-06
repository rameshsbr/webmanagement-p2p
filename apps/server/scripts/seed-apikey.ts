// apps/server/scripts/seed-apikey.ts
import { prisma } from "../src/lib/prisma.js";
import { randomBytes } from "node:crypto";
import { seal } from "../src/services/secretBox.js";

function randBase36(n: number) {
  // lowercase letters + digits, strip leading zeros
  return randomBytes(n).toString("base64url").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, n);
}

async function main() {
  const merchantId = process.env.MERCHANT_DEMO_ID!;
  if (!merchantId) throw new Error("MERCHANT_DEMO_ID not set");

  // Generate a readable prefix and a 32-char secret
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
      scopes: ["read:payments", "write:deposit", "read:deposit", "write:withdrawal", "read:withdrawal"],
      active: true,
    },
  });

  console.log("API key created:");
  console.log("  prefix:", key.prefix);
  console.log("  secret:", secret);
  console.log("Use header:");
  console.log(`  Authorization: Bearer ${key.prefix}.${secret}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
