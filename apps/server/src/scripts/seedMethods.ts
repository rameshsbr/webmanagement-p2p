import { prisma } from '../lib/prisma.js';

async function main() {
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

  const demoMerchant = await prisma.merchant.findFirst({ orderBy: { createdAt: 'asc' } });
  if (demoMerchant) {
    const defaultMethods = await prisma.method.findMany({ where: { code: { in: ['OSKO', 'PAYID'] } } });
    for (const method of defaultMethods) {
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

  console.log('Seeded default methods OSKO and PAYID');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
