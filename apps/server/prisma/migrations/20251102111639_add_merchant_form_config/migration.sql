-- CreateTable
CREATE TABLE "MerchantFormConfig" (
    "merchantId" TEXT NOT NULL,
    "deposit" JSONB,
    "withdrawal" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantFormConfig_pkey" PRIMARY KEY ("merchantId")
);

-- AddForeignKey
ALTER TABLE "MerchantFormConfig" ADD CONSTRAINT "MerchantFormConfig_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
