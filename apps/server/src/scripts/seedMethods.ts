import { prisma } from '../lib/prisma.js';

async function main() {
  await prisma.method.upsert({
    where: { code: 'OSKO' },
    update: { name: 'Osko', active: true },
    create: { code: 'OSKO', name: 'Osko', active: true },
  });

  await prisma.method.upsert({
    where: { code: 'PAYID' },
    update: { name: 'PayID', active: true },
    create: { code: 'PAYID', name: 'PayID', active: true },
  });

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
