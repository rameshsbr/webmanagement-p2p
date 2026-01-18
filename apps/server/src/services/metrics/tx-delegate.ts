// src/services/metrics/tx-delegate.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

/**
 * Adapter for legacy "Transaction" metrics calls, backed by PaymentRequest.
 * Supported surface:
 *  - count({ where? })
 *  - aggregate({ _sum: { amountCents?: true | amount?: true }, where? })
 */
type Where = Prisma.PaymentRequestWhereInput;

function mapWhere(where: any): Where {
  return (where || {}) as Where;
}

export const txDelegate = {
  async count(args?: { where?: any }) {
    return prisma.paymentRequest.count({ where: mapWhere(args?.where) });
  },

  async aggregate(args: { _sum?: { amountCents?: boolean; amount?: boolean }, where?: any }) {
    const wantAmountCents = !!args?._sum?.amountCents;
    const wantAmount = !!args?._sum?.amount;

    // If nothing we support is requested, return empty _sum.
    if (!wantAmountCents && !wantAmount) {
      return { _sum: {} as Record<string, number | null> };
    }

    const out = await prisma.paymentRequest.aggregate({
      where: mapWhere(args?.where),
      _sum: { amountCents: true },
    });

    const cents = out._sum.amountCents ?? null;

    // Return whichever shape the caller asked for.
    return {
      _sum: {
        ...(wantAmountCents ? { amountCents: cents } : {}),
        ...(wantAmount ? { amount: cents } : {}),
      },
    };
  },
};

/** Exported getter used by metrics callers */
export function getTxDelegate() {
  return txDelegate;
}