// additive helper – no imports changed elsewhere
import { prisma } from '../lib/prisma.js';

export async function getOrCreateStaticVaBinding(opts: {
  provider: 'FAZZ';
  merchantId: string;
  userId: string;
  bankCode: string;
  accountName: string;
  generateAccountNo: () => Promise<{ accountNo: string }>;
}) {
  const existing = await prisma.paymentMethodBinding.findUnique({
    where: {
      provider_merchantId_userId_methodType_bankCode: {
        provider: opts.provider,
        merchantId: opts.merchantId,
        userId: opts.userId,
        methodType: 'virtual_bank_account',
        bankCode: opts.bankCode,
      },
    },
  });
  if (existing && existing.active) return existing;

  const { accountNo } = await opts.generateAccountNo();
  return prisma.paymentMethodBinding.upsert({
    where: {
      provider_merchantId_userId_methodType_bankCode: {
        provider: opts.provider,
        merchantId: opts.merchantId,
        userId: opts.userId,
        methodType: 'virtual_bank_account',
        bankCode: opts.bankCode,
      },
    },
    create: {
      provider: 'FAZZ',
      merchantId: opts.merchantId,
      userId: opts.userId,
      methodType: 'virtual_bank_account',
      bankCode: opts.bankCode,
      accountNo,
      accountName: opts.accountName,
      active: true,
    },
    update: {
      accountName: opts.accountName,
      active: true,
    },
  });
}
