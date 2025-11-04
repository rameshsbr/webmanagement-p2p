-- AlterTable
ALTER TABLE "ReceiptFile" ADD COLUMN "paymentId" TEXT;

-- Backfill: map legacy single receipt to new relation
UPDATE "ReceiptFile" rf
SET "paymentId" = pr."id"
FROM "PaymentRequest" pr
WHERE pr."receiptFileId" IS NOT NULL
  AND rf."id" = pr."receiptFileId";

-- CreateIndex
CREATE INDEX "ReceiptFile_paymentId_createdAt_idx"
  ON "ReceiptFile"("paymentId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReceiptFile"
  ADD CONSTRAINT "ReceiptFile_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "PaymentRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;