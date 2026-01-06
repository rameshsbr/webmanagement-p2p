// apps/server/src/services/methods.ts
import { prisma } from "../lib/prisma.js";

/** List all methods (admin views etc.) */
export async function listAllMethods() {
  return prisma.method.findMany({ orderBy: { name: "asc" } });
}

/** List only methods enabled for a merchant */
export async function listMerchantMethods(merchantId: string) {
  if (!merchantId) return [];
  return prisma.method.findMany({
    where: {
      enabled: true,
      merchantLinks: { some: { merchantId, enabled: true } },
    },
    orderBy: { name: "asc" },
  });
}

/** Find a method by its code (case-insensitive trim) */
export async function findMethodByCode(code: string) {
  if (!code) return null;
  return prisma.method.findUnique({
    where: { code: code.trim().toUpperCase() },
  });
}

/** Ensure a given code is enabled for this merchant (returns the Method row) */
export async function ensureMerchantMethod(merchantId: string, code: string) {
  if (!merchantId || !code) return null;
  return prisma.method.findFirst({
    where: {
      code: code.trim().toUpperCase(),
      enabled: true,
      merchantLinks: { some: { merchantId, enabled: true } },
    },
  });
}

/**
 * Map local Method.code → provider adapter info.
 * This is used by merchantApi routes to decide which adapter to call.
 */
export function resolveProviderByMethodCode(code: string) {
  const upper = (code || "").trim().toUpperCase();

  // Fazz v4-ID Virtual Account rails
  if (upper === "VIRTUAL_BANK_ACCOUNT_STATIC" || upper === "VIRTUAL_BANK_ACCOUNT_DYNAMIC") {
    return { provider: "FAZZ", adapterName: "fazz" as const };
  }

  // You can add more mappings here for additional providers/rails
  return null;
}
