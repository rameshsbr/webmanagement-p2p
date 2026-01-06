// apps/server/scripts/refresh-one.ts
import { prisma } from '../src/lib/prisma.js';
import { resolveProviderByMethodCode } from '../src/services/methods.js';
import { adapters } from '../src/services/providers/index.js';

async function main() {
  const prId = process.argv[2];
  if (!prId) {
    console.error('Usage: pnpm exec tsx scripts/refresh-one.ts <paymentRequestId>');
    process.exit(1);
  }

  const pr = await prisma.paymentRequest.findUnique({ where: { id: prId } });
  if (!pr) throw new Error('PaymentRequest not found');

  const pp = await prisma.providerPayment.findUnique({ where: { paymentRequestId: pr.id } });
  if (!pp) {
    console.log('No ProviderPayment row. Nothing to poll.');
    return;
  }

  const methodCode = String(pr.detailsJson?.method || '');
  const res = resolveProviderByMethodCode(methodCode);
  if (!res) {
    console.log('No adapter mapping for method', methodCode);
    return;
  }

  const adapter = adapters[res.adapterName];
  const { status: providerStatus, raw } = await adapter.getDepositStatus(pp.providerPaymentId);

  // Persist latest provider snapshot
  await prisma.providerPayment.update({
    where: { paymentRequestId: pr.id },
    data: { status: providerStatus, rawLatestJson: raw ?? {} },
  });

  // Map to local status
  const norm = String(providerStatus || '').toLowerCase();
  let newStatus: 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | null = null;
  if (['paid', 'completed', 'success', 'succeeded'].includes(norm)) newStatus = 'APPROVED';
  else if (['failed', 'cancelled', 'canceled', 'rejected', 'expired'].includes(norm)) newStatus = 'REJECTED';

  if (newStatus && newStatus !== pr.status) {
    await prisma.paymentRequest.update({ where: { id: pr.id }, data: { status: newStatus } });
    console.log('Updated PaymentRequest', pr.id, '→', newStatus, '(provider:', providerStatus, ')');
  } else {
    console.log('No status change. provider:', providerStatus, 'local:', pr.status);
  }
}

main().finally(() => prisma.$disconnect());
