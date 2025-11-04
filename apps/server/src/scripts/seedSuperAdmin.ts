import { prisma } from '../lib/prisma.js';
import bcrypt from 'bcryptjs';

async function main() {
  const email = process.env.ADMIN_DEMO_EMAIL || 'super@example.com';
  const raw   = process.env.ADMIN_DEMO_PASSWORD || 'demo123';
  const hash  = await bcrypt.hash(raw, 10);

  const admin = await prisma.adminUser.upsert({
    where: { email },
    update: {
      role: 'SUPER',
      active: true,
      displayName: 'Super Admin',
      passwordHash: hash, // keep seed idempotent but refresh hash to the env value
    },
    create: {
      email,
      passwordHash: hash,
      role: 'SUPER',
      active: true,
      displayName: 'Super Admin',
    },
  });

  console.log('Seeded/updated admin:', admin.email, 'role=', admin.role, 'active=', admin.active);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });