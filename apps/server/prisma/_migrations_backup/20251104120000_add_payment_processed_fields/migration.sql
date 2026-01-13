-- AlterTable
ALTER TABLE "PaymentRequest"
  ADD COLUMN     "processedByAdminId" TEXT,
  ADD COLUMN     "processedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PaymentRequest_processedByAdminId_idx" ON "PaymentRequest"("processedByAdminId");

-- AddForeignKey
ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_processedByAdminId_fkey"
  FOREIGN KEY ("processedByAdminId") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
