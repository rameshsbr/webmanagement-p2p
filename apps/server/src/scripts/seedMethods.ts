import { prisma } from '../lib/prisma.js';
import { defaultIdrV4MethodBanks } from '../services/methodBanks.js';

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

  await prisma.method.upsert({
    where: { code: 'AUD_NPP' },
    update: { name: 'AUD · NPP', enabled: true },
    create: { code: 'AUD_NPP', name: 'AUD · NPP', enabled: true },
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

  const idrV4Defaults = defaultIdrV4MethodBanks();
  const idrV4Methods = await prisma.method.findMany({
    where: { code: { in: ['VIRTUAL_BANK_ACCOUNT_STATIC', 'VIRTUAL_BANK_ACCOUNT_DYNAMIC'] } },
    select: { id: true, code: true },
  });
  for (const method of idrV4Methods) {
    const existingCount = await prisma.methodBank.count({ where: { methodId: method.id } });
    if (existingCount > 0) continue;
    await prisma.methodBank.createMany({
      data: idrV4Defaults.map((bank) => ({
        methodId: method.id,
        code: bank.code,
        label: bank.label,
        active: bank.active ?? true,
        sort: bank.sort ?? 1000,
      })),
      skipDuplicates: true,
    });
  }

  // Link to the first merchant (idempotent)
  const demoMerchant = await prisma.merchant.findFirst({ orderBy: { createdAt: 'asc' } });
  if (demoMerchant) {
    const codes = ['OSKO','PAYID','AUD_NPP','VIRTUAL_BANK_ACCOUNT_STATIC','VIRTUAL_BANK_ACCOUNT_DYNAMIC','FAZZ_SEND'];
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

  console.log('Seeded methods: OSKO, PAYID, AUD · NPP, IDR v4 (VA Static/Dynamic, BI FAST)');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
