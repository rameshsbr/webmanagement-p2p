import { prisma } from "../lib/prisma.js";
import type { PaymentType } from "@prisma/client";

export type TargetStatus = "APPROVED" | "REJECTED";

export class PaymentStatusError extends Error {
  constructor(message: string, public code: "NOT_FOUND" | "INVALID_STATE" | "INSUFFICIENT_FUNDS" | "INVALID_AMOUNT") {
    super(message);
    this.name = "PaymentStatusError";
  }
}

export type StatusChangeOptions = {
  paymentId: string;
  targetStatus: TargetStatus;
  actorAdminId?: string | null;
  amountCents?: number | null;
  comment?: string | null;
  bankAccountId?: string | null;
};

type LoadedPayment = NonNullable<Awaited<ReturnType<typeof loadPaymentForResult>>>;

type ChangeResult = {
  payment: LoadedPayment;
  balanceDelta: number;
};

async function loadPaymentForResult(id: string) {
  return prisma.paymentRequest.findUnique({
    where: { id },
    include: {
      merchant: { select: { id: true, name: true, balanceCents: true } },
      processedByAdmin: { select: { id: true, email: true, displayName: true } },
    },
  });
}

function assertAmount(amount: number | null | undefined): number | null {
  if (amount === null || amount === undefined) return null;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PaymentStatusError("Invalid amount", "INVALID_AMOUNT");
  }
  return Math.round(amount);
}

async function ensurePayment(paymentId: string) {
  const payment = await prisma.paymentRequest.findUnique({
    where: { id: paymentId },
    include: {
      merchant: { select: { id: true, balanceCents: true, name: true } },
    },
  });
  if (!payment) throw new PaymentStatusError("Payment not found", "NOT_FOUND");
  return payment;
}

async function changeDepositStatus({
  paymentId,
  targetStatus,
  actorAdminId,
  amountCents,
  comment,
}: StatusChangeOptions): Promise<ChangeResult> {
  const normalizedAmount = assertAmount(amountCents);

  return prisma.$transaction(async (tx) => {
    const payment = await tx.paymentRequest.findUnique({
      where: { id: paymentId },
      include: {
        merchant: { select: { id: true, balanceCents: true, name: true } },
      },
    });
    if (!payment) throw new PaymentStatusError("Payment not found", "NOT_FOUND");
    if (payment.type !== "DEPOSIT") {
      throw new PaymentStatusError("Invalid payment type", "INVALID_STATE");
    }

    const ledger = await tx.ledgerEntry.findFirst({ where: { paymentId } });
    const existingAmount = ledger?.amountCents ?? 0;
    const nextAmount = normalizedAmount ?? payment.amountCents;
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      throw new PaymentStatusError("Invalid amount", "INVALID_AMOUNT");
    }

    const now = new Date();
    let balanceDelta = 0;

    if (targetStatus === "APPROVED") {
      const delta = nextAmount - existingAmount;
      if (delta < 0 && payment.merchant.balanceCents < Math.abs(delta)) {
        throw new PaymentStatusError("Insufficient Balance", "INSUFFICIENT_FUNDS");
      }

      if (ledger) {
        await tx.ledgerEntry.update({ where: { id: ledger.id }, data: { amountCents: nextAmount } });
      } else {
        await tx.ledgerEntry.create({
          data: {
            merchantId: payment.merchantId,
            amountCents: nextAmount,
            reason: `Deposit ${payment.referenceCode}`,
            paymentId: payment.id,
          },
        });
      }

      if (delta !== 0) {
        balanceDelta = delta;
        await tx.merchant.update({
          where: { id: payment.merchantId },
          data: { balanceCents: { increment: delta } },
        });
      }

      await tx.paymentRequest.update({
        where: { id: payment.id },
        data: {
          status: "APPROVED",
          amountCents: nextAmount,
          notes: comment?.trim() ? comment.trim() : payment.notes,
          rejectedReason: null,
          processedAt: now,
          processedByAdminId: actorAdminId ?? null,
        },
      });
    } else {
      if (ledger) {
        if (payment.merchant.balanceCents < existingAmount) {
          throw new PaymentStatusError("Insufficient Balance", "INSUFFICIENT_FUNDS");
        }
        balanceDelta = -existingAmount;
        await tx.merchant.update({
          where: { id: payment.merchantId },
          data: { balanceCents: { decrement: existingAmount } },
        });
        await tx.ledgerEntry.delete({ where: { id: ledger.id } });
      }

      await tx.paymentRequest.update({
        where: { id: payment.id },
        data: {
          status: "REJECTED",
          rejectedReason: comment?.trim() || null,
          notes: comment?.trim() || payment.notes,
          processedAt: now,
          processedByAdminId: actorAdminId ?? null,
        },
      });
    }

    const updated = await loadPaymentForResult(payment.id);
    if (!updated) throw new PaymentStatusError("Payment not found", "NOT_FOUND");
    return { payment: updated, balanceDelta };
  });
}

async function changeWithdrawalStatus({
  paymentId,
  targetStatus,
  actorAdminId,
  amountCents,
  comment,
  bankAccountId,
}: StatusChangeOptions): Promise<ChangeResult> {
  const normalizedAmount = assertAmount(amountCents);

  return prisma.$transaction(async (tx) => {
    const payment = await tx.paymentRequest.findUnique({
      where: { id: paymentId },
      include: {
        merchant: { select: { id: true, balanceCents: true, name: true } },
      },
    });
    if (!payment) throw new PaymentStatusError("Payment not found", "NOT_FOUND");
    if (payment.type !== "WITHDRAWAL") {
      throw new PaymentStatusError("Invalid payment type", "INVALID_STATE");
    }

    const ledger = await tx.ledgerEntry.findFirst({ where: { paymentId } });
    const existingAmount = ledger?.amountCents ?? 0; // negative when present
    const nextAmount = normalizedAmount ?? payment.amountCents;
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      throw new PaymentStatusError("Invalid amount", "INVALID_AMOUNT");
    }
    const nextLedgerAmount = -Math.abs(nextAmount);
    const now = new Date();
    let balanceDelta = 0;

    if (targetStatus === "APPROVED") {
      const delta = nextLedgerAmount - existingAmount;
      const currentBalance = payment.merchant.balanceCents;
      if (currentBalance + delta < 0) {
        throw new PaymentStatusError("Insufficient Balance", "INSUFFICIENT_FUNDS");
      }

      if (ledger) {
        await tx.ledgerEntry.update({ where: { id: ledger.id }, data: { amountCents: nextLedgerAmount } });
      } else {
        await tx.ledgerEntry.create({
          data: {
            merchantId: payment.merchantId,
            amountCents: nextLedgerAmount,
            reason: `Withdrawal ${payment.referenceCode}`,
            paymentId: payment.id,
          },
        });
      }

      if (delta !== 0) {
        balanceDelta = delta;
        await tx.merchant.update({
          where: { id: payment.merchantId },
          data: { balanceCents: { increment: delta } },
        });
      }

      const updateData: any = {
        status: "APPROVED",
        amountCents: nextAmount,
        notes: comment?.trim() ? comment.trim() : payment.notes,
        rejectedReason: null,
        processedAt: now,
        processedByAdminId: actorAdminId ?? null,
      };

      if (bankAccountId !== undefined) {
        updateData.bankAccountId = bankAccountId ?? null;
      }

      await tx.paymentRequest.update({
        where: { id: payment.id },
        data: updateData,
      });
    } else {
      if (ledger) {
        balanceDelta = -existingAmount;
        await tx.merchant.update({
          where: { id: payment.merchantId },
          data: { balanceCents: { increment: -existingAmount } },
        });
        await tx.ledgerEntry.delete({ where: { id: ledger.id } });
      }

      await tx.paymentRequest.update({
        where: { id: payment.id },
        data: {
          status: "REJECTED",
          rejectedReason: comment?.trim() || null,
          notes: comment?.trim() || payment.notes,
          processedAt: now,
          processedByAdminId: actorAdminId ?? null,
        },
      });
    }

    const updated = await loadPaymentForResult(payment.id);
    if (!updated) throw new PaymentStatusError("Payment not found", "NOT_FOUND");
    return { payment: updated, balanceDelta };
  });
}

export async function changePaymentStatus(
  type: PaymentType,
  options: StatusChangeOptions,
): Promise<ChangeResult> {
  if (type === "DEPOSIT") return changeDepositStatus(options);
  if (type === "WITHDRAWAL") return changeWithdrawalStatus(options);
  throw new PaymentStatusError("Unsupported payment type", "INVALID_STATE");
}

export async function requirePayment(paymentId: string) {
  return ensurePayment(paymentId);
}
