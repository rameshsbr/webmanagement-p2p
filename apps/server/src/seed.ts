// apps/server/src/seed.ts  (clean copy)
import { prisma } from './lib/prisma.js';
import { hash } from './services/crypto.js';
import { seal } from './services/secretBox.js';
import { generateBankPublicId } from './services/reference.js';

async function main() {
  const adminExists = await prisma.adminUser.findFirst();
  if (!adminExists) {
    await prisma.adminUser.create({
      data: { email: 'admin@example.com', passwordHash: await hash('admin123') }
    });
  }

  let m = await prisma.merchant.findFirst({ where: { name: 'DemoCasino' } });
  if (!m) {
    m = await prisma.merchant.create({ data: { name: 'DemoCasino', balanceCents: 0, userDirectoryEnabled: true } });
  } else if (!m.userDirectoryEnabled) {
    m = await prisma.merchant.update({ where: { id: m.id }, data: { userDirectoryEnabled: true } });
  }

  const hasKey = await prisma.merchantApiKey.findFirst({ where: { merchantId: m.id } });
  if (!hasKey) {
    const prefix = 'demoPub1';
    const secret = 'demo_secret_token_1234';
    await prisma.merchantApiKey.create({
      data: {
        merchantId: m.id,
        prefix,
        secretEnc: seal(secret),
        last4: secret.slice(-4),
        scopes: ['read:payments'],
      }
    });
    console.log(`Merchant API key: ${prefix}.${secret}`);
  }

  const bank = await prisma.bankAccount.findFirst({
    where: { currency: 'USD', merchantId: null }
  });
  if (!bank) {
    await prisma.bankAccount.create({
      data: {
        publicId: generateBankPublicId(),
        currency: 'USD',
        holderName: 'ACME Payments Ltd',
        bankName: 'Bank of Nowhere',
        accountNo: '00112233',
        iban: 'US00B0N000112233',
        instructions: 'Use your reference code in transfer notes',
        active: true
      }
    });
  }

  console.log('Seeded. Admin login: admin@example.com / admin123');
}

main().finally(() => prisma.$disconnect());