import { prisma } from '../lib/prisma.js';

const email = process.argv[2] || 'admin@example.com';

(async () => {
  const a = await prisma.adminUser.findFirst({
    where: { email },
    select: { id: true, email: true, twoFactorEnabled: true, totpSecret: true }
  });
  console.log(a);
  process.exit(0);
})();
