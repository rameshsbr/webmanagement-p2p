// apps/server/src/services/merchantAccounts.ts
import path from "node:path";
import { prisma } from "../lib/prisma.js";
import type { MerchantAccountEntryType } from "@prisma/client";

type ReceiptPayload = {
  path: string;
  mimeType: string;
  original: string;
  size: number;
};

export type AccountEntryInput = {
  merchantId: string;
  type: MerchantAccountEntryType;
  amountCents: number;
  method?: string | null;
  note?: string | null;
  adminId?: string | null;
  receipt?: ReceiptPayload | null;
};

export async function createAccountEntry(input: AccountEntryInput) {
  if (!input.merchantId) throw new Error("merchantId is required");
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    throw new Error("amountCents must be a positive integer");
  }

  return prisma.$transaction(async (tx) => {
    let receipt: { id: string } | null = null;
    if (input.receipt) {
      receipt = await tx.receiptFile.create({
        data: {
          original: input.receipt.original,
          mimeType: input.receipt.mimeType,
          size: input.receipt.size,
          path: input.receipt.path.startsWith("/uploads/")
            ? input.receipt.path
            : "/uploads/" + path.basename(input.receipt.path),
        },
        select: { id: true },
      });
    }

    const entry = await tx.merchantAccountEntry.create({
      data: {
        merchantId: input.merchantId,
        type: input.type,
        amountCents: input.amountCents,
        method: input.method || null,
        note: input.note || null,
        receiptFileId: receipt?.id ?? null,
        createdById: input.adminId || null,
      },
      include: {
        merchant: { select: { id: true, name: true } },
        createdBy: { select: { id: true, displayName: true, email: true } },
        receiptFile: { select: { id: true, path: true, original: true } },
      },
    });

    await tx.merchant.update({
      where: { id: input.merchantId },
      data: {
        balanceCents:
          entry.type === "TOPUP"
            ? { increment: entry.amountCents }
            : { decrement: entry.amountCents },
      },
    });

    await tx.ledgerEntry.create({
      data: {
        merchantId: input.merchantId,
        amountCents: entry.type === "TOPUP" ? entry.amountCents : -entry.amountCents,
        reason:
          entry.type === "TOPUP"
            ? `Topup${entry.method ? ` via ${entry.method}` : ""}`
            : `Settlement${entry.method ? ` via ${entry.method}` : ""}`,
      },
    });

    return entry;
  });
}

export async function listMerchantBalances() {
  const merchants = await prisma.merchant.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      balanceCents: true,
      defaultCurrency: true,
      updatedAt: true,
      accountEntries: {
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  return merchants.map((m) => ({
    id: m.id,
    name: m.name,
    balanceCents: m.balanceCents,
    currency: m.defaultCurrency,
    lastActivityAt: m.accountEntries[0]?.createdAt ?? m.updatedAt,
  }));
}

export async function listAccountEntries(opts: {
  type?: MerchantAccountEntryType | null;
  merchantId?: string | null;
}) {
  const entries = await prisma.merchantAccountEntry.findMany({
    where: {
      ...(opts.type ? { type: opts.type } : {}),
      ...(opts.merchantId ? { merchantId: opts.merchantId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      merchant: { select: { id: true, name: true } },
      createdBy: { select: { id: true, displayName: true, email: true } },
      receiptFile: { select: { id: true, path: true, original: true } },
    },
  });

  return entries.map((entry) => ({
    id: entry.id,
    merchant: entry.merchant,
    type: entry.type,
    method: entry.method,
    amountCents: entry.amountCents,
    note: entry.note,
    createdAt: entry.createdAt,
    admin: entry.createdBy
      ? entry.createdBy.displayName || entry.createdBy.email || "—"
      : "—",
    receipt: entry.receiptFile
      ? { id: entry.receiptFile.id, path: entry.receiptFile.path, name: entry.receiptFile.original }
      : null,
  }));
}
