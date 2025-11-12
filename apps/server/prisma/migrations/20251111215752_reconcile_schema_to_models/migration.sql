-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "canRevealMerchantApiKeys" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timezone" TEXT;

-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "apiKeysSelfServiceEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "MerchantUser" ADD COLUMN     "canRevealApiKeys" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timezone" TEXT;

-- CreateTable
CREATE TABLE "MerchantApiKeyRevealLog" (
    "id" TEXT NOT NULL,
    "merchantApiKeyId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "merchantUserId" TEXT,
    "adminUserId" TEXT,
    "reason" TEXT,
    "outcome" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantApiKeyRevealLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MerchantApiKeyRevealLog_merchantApiKeyId_createdAt_idx" ON "MerchantApiKeyRevealLog"("merchantApiKeyId", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantApiKeyRevealLog_merchantUserId_createdAt_idx" ON "MerchantApiKeyRevealLog"("merchantUserId", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantApiKeyRevealLog_adminUserId_createdAt_idx" ON "MerchantApiKeyRevealLog"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantApiKeyRevealLog_merchantId_createdAt_idx" ON "MerchantApiKeyRevealLog"("merchantId", "createdAt");

-- AddForeignKey
ALTER TABLE "MerchantApiKeyRevealLog" ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantApiKeyId_fkey" FOREIGN KEY ("merchantApiKeyId") REFERENCES "MerchantApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantApiKeyRevealLog" ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantApiKeyRevealLog" ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantUserId_fkey" FOREIGN KEY ("merchantUserId") REFERENCES "MerchantUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantApiKeyRevealLog" ADD CONSTRAINT "MerchantApiKeyRevealLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
