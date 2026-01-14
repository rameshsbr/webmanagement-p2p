import { prisma } from '../lib/prisma.js';

async function main() {
  // Existing AU methods
  await prisma.method.upsert({
    where: { code: 'OSKO' },
    update: { name: 'Osko', enabled: true },
    create: { code: 'OSKO', name: 'Osko', enabled: true },
  });

  await prisma.method.upsert({
    where: { code: 'PAYID' },
    update: { name: 'PayID', enabled: true },
    create: { code: 'PAYID', name: 'PayID', enabled: true },
  });

  // NEW: IDR v4 methods
  await prisma.method.upsert({
    where: { code: 'VIRTUAL_BANK_ACCOUNT_STATIC' },
    update: { name: 'IDR v4 — VA Static', enabled: true },
    create: { code: 'VIRTUAL_BANK_ACCOUNT_STATIC', name: 'IDR v4 — VA Static', enabled: true },
  });

  await prisma.method.upsert({
    where: { code: 'VIRTUAL_BANK_ACCOUNT_DYNAMIC' },
    update: { name: 'IDR v4 — VA Dynamic', enabled: true },
    create: { code: 'VIRTUAL_BANK_ACCOUNT_DYNAMIC', name: 'IDR v4 — VA Dynamic', enabled: true },
  });

  await prisma.method.upsert({
    where: { code: 'FAZZ_SEND' },
    update: { name: 'IDR v4 — BI FAST', enabled: true },
    create: { code: 'FAZZ_SEND', name: 'IDR v4 — BI FAST', enabled: true },
  });

  // Link to the first merchant (idempotent)
  const demoMerchant = await prisma.merchant.findFirst({ orderBy: { createdAt: 'asc' } });
  if (demoMerchant) {
    const codes = ['OSKO','PAYID','VIRTUAL_BANK_ACCOUNT_STATIC','VIRTUAL_BANK_ACCOUNT_DYNAMIC','FAZZ_SEND'];
    const methods = await prisma.method.findMany({ where: { code: { in: codes } } });
    for (const method of methods) {
      await prisma.merchantMethod.upsert({
        where: {
          merchantId_methodId: {
            merchantId: demoMerchant.id,
            methodId: method.id,
          },
        },
        update: { enabled: true },
        create: {
          merchantId: demoMerchant.id,
          methodId: method.id,
          enabled: true,
        },
      });
    }
    console.log(`Assigned default methods to merchant ${demoMerchant.name}`);
  }

  console.log('Seeded methods: OSKO, PAYID, IDR v4 (VA Static/Dynamic, BI FAST)');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });