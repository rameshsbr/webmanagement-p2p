-- Rename MerchantClient table to MerchantClientMapping to avoid schema duplication
ALTER TABLE "MerchantClient" RENAME TO "MerchantClientMapping";
ALTER TABLE "MerchantClientMapping" RENAME CONSTRAINT "MerchantClient_pkey" TO "MerchantClientMapping_pkey";
ALTER TABLE "MerchantClientMapping" RENAME CONSTRAINT "MerchantClient_merchantId_fkey" TO "MerchantClientMapping_merchantId_fkey";
ALTER TABLE "MerchantClientMapping" RENAME CONSTRAINT "MerchantClient_userId_fkey" TO "MerchantClientMapping_userId_fkey";

ALTER INDEX "MerchantClient_diditSubject_key" RENAME TO "MerchantClientMapping_diditSubject_key";
ALTER INDEX "MerchantClient_merchantId_externalId_key" RENAME TO "MerchantClientMapping_merchantId_externalId_key";
ALTER INDEX "MerchantClient_userId_idx" RENAME TO "MerchantClientMapping_userId_idx";
