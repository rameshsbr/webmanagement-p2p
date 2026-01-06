import { prisma } from "../lib/prisma.js";

export async function computeAndApplyFee(opts: { merchantId: string; methodId: string; amountCents: number; paymentRequestId: string; context: "DEPOSIT" | "WITHDRAWAL" }) {
  const rule = await prisma.feeRule.findFirst({ where: { merchantId: opts.merchantId, methodId: opts.methodId, active: true } });
  if (!rule) return { feeCents: 0 };

  let feeCents = 0;
  if (rule.kind === "FIXED" && rule.amountCents) feeCents = rule.amountCents;
  if (rule.kind === "PERCENT" && rule.percentBps) feeCents = Math.floor(opts.amountCents * rule.percentBps / 10000);

  // TODO: create ledger entries to move fee to Fees account and reduce merchant available balance
  // await prisma.merchantAccountEntry.create(...)

  return { feeCents };
}
