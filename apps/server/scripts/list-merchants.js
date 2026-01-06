// apps/server/scripts/list-merchants.ts
import { prisma } from "../src/lib/prisma.js";
async function main() {
    const rows = await prisma.merchant.findMany({
        select: { id: true, name: true, email: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 50,
    });
    console.table(rows);
}
main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); });
