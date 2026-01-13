-- CreateEnum
CREATE TYPE "MerchantAccountEntryType" AS ENUM ('TOPUP', 'SETTLEMENT');

-- CreateTable
CREATE TABLE "MerchantAccountEntry" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "type" "MerchantAccountEntryType" NOT NULL,
  "method" TEXT,
  "amountCents" INTEGER NOT NULL,
  "note" TEXT,
  "receiptFileId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantAccountEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MerchantAccountEntry_receiptFileId_key" UNIQUE ("receiptFileId")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MerchantAccountEntry_createdAt_idx" ON "MerchantAccountEntry"("createdAt");
CREATE INDEX IF NOT EXISTS "MerchantAccountEntry_merchantId_type_createdAt_idx" ON "MerchantAccountEntry"("merchantId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "MerchantAccountEntry"
  ADD CONSTRAINT "MerchantAccountEntry_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "MerchantAccountEntry"
  ADD CONSTRAINT "MerchantAccountEntry_receiptFileId_fkey"
  FOREIGN KEY ("receiptFileId") REFERENCES "ReceiptFile"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "MerchantAccountEntry"
  ADD CONSTRAINT "MerchantAccountEntry_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
