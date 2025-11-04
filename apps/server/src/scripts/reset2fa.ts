import { prisma } from '../lib/prisma.js';

const email = process.argv[2] || 'admin@example.com';

(async () => {
  const a = await prisma.adminUser.update({
    where: { email },
    data: { twoFactorEnabled: false, totpSecret: null }
  });
  console.log('2FA reset for', a.email);
  process.exit(0);
})();
