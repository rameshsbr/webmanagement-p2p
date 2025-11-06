import { prisma } from "../lib/prisma.js";
import {
  generateTransactionId,
  generateUniqueReference,
  generateUserId,
  generateBankPublicId,
} from "./reference.js";

async function ensureUniquePaymentReference(id: string, field: "referenceCode" | "uniqueReference", generator: () => string) {
  while (true) {
    const next = generator();
    try {
      await prisma.paymentRequest.update({
        where: { id },
        data: { [field]: next },
      } as any);
      return;
    } catch (err: any) {
      if (err?.code === "P2002") continue; // unique constraint violation → try again
      throw err;
    }
  }
}

async function ensureUniqueUserId(id: string) {
  while (true) {
    const next = generateUserId();
    try {
      await prisma.user.update({ where: { id }, data: { publicId: next } });
      return;
    } catch (err: any) {
      if (err?.code === "P2002") continue;
      throw err;
    }
  }
}

async function ensureUniqueBankId(id: string) {
  while (true) {
    const next = generateBankPublicId();
    try {
      await prisma.bankAccount.update({ where: { id }, data: { publicId: next } });
      return;
    } catch (err: any) {
      if (err?.code === "P2002") continue;
      throw err;
    }
  }
}

export async function backfillShortIdentifiers() {
  try {
    const payments = await prisma.paymentRequest.findMany({
      where: {
        OR: [
          { referenceCode: { not: { startsWith: "T" } } },
          { uniqueReference: { not: { startsWith: "UB" } } },
        ],
      },
      select: { id: true, referenceCode: true, uniqueReference: true },
      take: 500,
    });

    for (const payment of payments) {
      if (!payment.referenceCode?.startsWith("T")) {
        await ensureUniquePaymentReference(payment.id, "referenceCode", generateTransactionId);
      }
      if (!payment.uniqueReference?.startsWith("UB")) {
        await ensureUniquePaymentReference(payment.id, "uniqueReference", generateUniqueReference);
      }
    }

    const users = await prisma.user.findMany({
      where: { publicId: { not: { startsWith: "U" } } },
      select: { id: true, publicId: true },
      take: 500,
    });
    for (const user of users) {
      await ensureUniqueUserId(user.id);
    }

    const banks = await prisma.bankAccount.findMany({
      where: { publicId: { not: { startsWith: "BI" } } },
      select: { id: true, publicId: true },
      take: 500,
    });
    for (const bank of banks) {
      await ensureUniqueBankId(bank.id);
    }
  } catch (err) {
    console.warn("[backfill] short-id migration skipped", (err as any)?.message || err);
  }
}
