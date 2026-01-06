// apps/server/scripts/mark-completed.ts
// Usage:
//   pnpm exec tsx scripts/mark-completed.ts <paymentRequestId> [status]
// Example:
//   pnpm exec tsx scripts/mark-completed.ts cmk2plny80004365xxo2z7j45 completed

import { prisma } from '../src/lib/prisma.js';

async function main() {
  const prId = process.argv[2];
  const newStatus = (process.argv[3] || 'completed').toLowerCase();

  if (!prId) {
    console.error('Usage: pnpm exec tsx scripts/mark-completed.ts <paymentRequestId> [status]');
    process.exit(1);
  }

  // sanity: ensure PR exists
  const pr = await prisma.paymentRequest.findUnique({
    where: { id: prId },
    select: { id: true, referenceCode: true, status: true, detailsJson: true },
  });

  if (!pr) {
    console.error('PaymentRequest not found:', prId);
    process.exit(1);
  }

  // find provider payment row
  const pp = await prisma.providerPayment.findUnique({
    where: { paymentRequestId: prId },
  });

  if (!pp) {
    console.error('No ProviderPayment row for PR:', prId);
    process.exit(1);
  }

  // flip provider status to the desired terminal/success state
  const updated = await prisma.providerPayment.update({
    where: { paymentRequestId: prId },
    data: {
      status: newStatus,              // e.g., "completed" | "paid" | "success" | "succeeded"
      rawLatestJson: {
        simulated: true,
        providerPaymentId: pp.providerPaymentId,
        status: newStatus,
      },
    },
  });

  console.log(
    `Marked ProviderPayment for PR=${pr.id} (ref=${pr.referenceCode}) → provider status: ${updated.status}`
  );
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
