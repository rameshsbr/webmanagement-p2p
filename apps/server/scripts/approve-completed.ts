// apps/server/scripts/approve-completed.ts
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const rows = await prisma.providerPayment.findMany({
    where: {
      status: { in: ["paid", "completed", "success", "succeeded"] }
    },
    select: { paymentRequestId: true }
  });

  if (!rows.length) {
    console.log("No provider payments in a completed/paid state.");
    return;
  }

  const ids = rows.map(r => r.paymentRequestId);
  const updated = await prisma.paymentRequest.updateMany({
    where: { id: { in: ids }, status: "PENDING", type: "DEPOSIT" },
    data: { status: "APPROVED" }
  });

  console.log(`Updated ${updated.count} paymentRequest(s) to APPROVED.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
