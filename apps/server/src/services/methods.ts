// apps/server/src/services/methods.ts
import { prisma } from "../lib/prisma.js";

export const IDR_V4_METHOD_PREFIX = "VIRTUAL_BANK_ACCOUNT_";
export const IDR_V4_METHOD_CODES = [
  "VIRTUAL_BANK_ACCOUNT_DYNAMIC",
  "VIRTUAL_BANK_ACCOUNT_STATIC",
  "FAZZ_SEND",
] as const;
const IDR_V4_METHOD_SET = new Set<string>(IDR_V4_METHOD_CODES);
export const AUD_NPP_METHOD_CODE = "AUD_NPP";

export function isIdrV4Method(code: string) {
  const upper = (code || "").trim().toUpperCase();
  return upper.startsWith(IDR_V4_METHOD_PREFIX) || IDR_V4_METHOD_SET.has(upper);
}

export function isAudNppMethod(code: string) {
  return (code || "").trim().toUpperCase() === AUD_NPP_METHOD_CODE;
}

/** List all methods (admin views etc.) */
export async function listAllMethods() {
  return prisma.method.findMany({ orderBy: { name: "asc" } });
}

/** List only non-IDR v4 methods (P2P banks). */
export async function listP2PMethods() {
  return prisma.method.findMany({
    where: {
      AND: [
        { NOT: { code: { startsWith: IDR_V4_METHOD_PREFIX } } },
        { NOT: { code: { in: IDR_V4_METHOD_CODES as unknown as string[] } } },
        { NOT: { code: AUD_NPP_METHOD_CODE } },
      ],
    },
    orderBy: { name: "asc" },
  });
}

/** List only methods enabled for a merchant */
export async function listMerchantMethods(merchantId: string) {
  if (!merchantId) return [];
  const methods = await prisma.method.findMany({
    where: {
      enabled: true,
      merchantLinks: { some: { merchantId, enabled: true } },
    },
    orderBy: { name: "asc" },
  });
  if (methods.length) return methods;

  const isDev =
    String(process.env.IS_LOCAL || "").toLowerCase() === "true" ||
    String(process.env.NODE_ENV || "").toLowerCase() !== "production";
  if (!isDev) return methods;

  return [
    {
      id: "dev-osko",
      code: "OSKO",
      name: "Osko",
      enabled: true,
      minDepositCents: 50 * 100,
      maxDepositCents: 5000 * 100,
    },
    {
      id: "dev-payid",
      code: "PAYID",
      name: "PayID",
      enabled: true,
      minDepositCents: 50 * 100,
      maxDepositCents: 5000 * 100,
    },
    {
      id: "dev-aud-npp",
      code: AUD_NPP_METHOD_CODE,
      name: "AUD · NPP",
      enabled: true,
      minDepositCents: 50 * 100,
      maxDepositCents: 5000 * 100,
    },
    {
      id: "dev-idr-dyn",
      code: "VIRTUAL_BANK_ACCOUNT_DYNAMIC",
      name: "IDR VA Dynamic",
      enabled: true,
      minDepositCents: 10000,
      maxDepositCents: 500000000,
    },
    {
      id: "dev-idr-sta",
      code: "VIRTUAL_BANK_ACCOUNT_STATIC",
      name: "IDR VA Static",
      enabled: true,
      minDepositCents: 10000,
      maxDepositCents: 500000000,
    },
  ] as any[];
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
