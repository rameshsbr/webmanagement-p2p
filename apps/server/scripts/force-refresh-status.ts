// apps/server/scripts/force-refresh-status.ts
import { prisma } from '../src/lib/prisma.js';

function isSuccess(s?: string | null) {
  const n = String(s || '').toLowerCase();
  return ['paid', 'completed', 'success', 'succeeded'].includes(n);
}

(async () => {
  try {
    const pr = await prisma.paymentRequest.findFirst({
      where: { type: 'DEPOSIT', status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, referenceCode: true }
    });

    if (!pr) {
      console.log('No pending PaymentRequest found');
      process.exit(0);
    }

    const pp = await prisma.providerPayment.findUnique({
      where: { paymentRequestId: pr.id },
      select: { status: true }
    });

    if (!pp) {
      console.log('No ProviderPayment for PR', pr.id);
      process.exit(0);
    }

    console.log('PR', pr.id, pr.referenceCode, 'provider status =>', pp.status);
    if (isSuccess(pp.status)) {
      await prisma.paymentRequest.update({
        where: { id: pr.id },
        data: { status: 'APPROVED' }
      });
      console.log('Updated PR to APPROVED');
    } else {
      console.log('Still pending-ish; no change');
    }
  } catch (e: any) {
    console.error('force-refresh failed:', e?.message || e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
