import { prisma } from "../lib/prisma.js";

export async function listAllMethods() {
  return prisma.method.findMany({ orderBy: { name: "asc" } });
}

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

export async function findMethodByCode(code: string) {
  if (!code) return null;
  return prisma.method.findUnique({ where: { code: code.trim().toUpperCase() } });
}

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
