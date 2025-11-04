// apps/server/src/seed.ts  (clean copy)
import { prisma } from './lib/prisma.js';
import { hash } from './services/crypto.js';

async function main() {
  const adminExists = await prisma.adminUser.findFirst();
  if (!adminExists) {
    await prisma.adminUser.create({
      data: { email: 'admin@example.com', passwordHash: await hash('admin123') }
    });
  }

  let m = await prisma.merchant.findFirst({ where: { name: 'DemoCasino' } });
  if (!m) {
    m = await prisma.merchant.create({ data: { name: 'DemoCasino', balanceCents: 0 } });
  }

  const hasKey = await prisma.merchantApiKey.findFirst({ where: { merchantId: m.id } });
  if (!hasKey) {
    await prisma.merchantApiKey.create({
      data: { merchantId: m.id, publicKey: 'pub_demo', secretHash: 'sec_demo' }
    });
  }

  const bank = await prisma.bankAccount.findFirst({
    where: { currency: 'USD', merchantId: null }
  });
  if (!bank) {
    await prisma.bankAccount.create({
      data: {
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
  console.log('Merchant: DemoCasino | API pub=pub_demo secret=sec_demo');
}

main().finally(() => prisma.$disconnect());