-- Re-assert safe delete behaviours to avoid cascading data loss
-- Drop cascade-based foreign keys introduced in later migrations
ALTER TABLE "MerchantAccountEntry" DROP CONSTRAINT IF EXISTS "MerchantAccountEntry_merchantId_fkey";
ALTER TABLE "MerchantApiKeyRevealLog" DROP CONSTRAINT IF EXISTS "MerchantApiKeyRevealLog_merchantApiKeyId_fkey";
ALTER TABLE "MerchantApiKeyRevealLog" DROP CONSTRAINT IF EXISTS "MerchantApiKeyRevealLog_merchantId_fkey";
ALTER TABLE "MerchantClient" DROP CONSTRAINT IF EXISTS "MerchantClient_merchantId_fkey";
ALTER TABLE "MerchantClient" DROP CONSTRAINT IF EXISTS "MerchantClient_userId_fkey";

-- Allow merchant clients to survive parent deletion by nullable FK
ALTER TABLE "MerchantClient" ALTER COLUMN "userId" DROP NOT NULL;

-- Recreate foreign keys with RESTRICT / SET NULL semantics
ALTER TABLE "MerchantAccountEntry"
  ADD CONSTRAINT "MerchantAccountEntry_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MerchantApiKeyRevealLog"
  ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantApiKeyId_fkey"
  FOREIGN KEY ("merchantApiKeyId") REFERENCES "MerchantApiKey"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MerchantApiKeyRevealLog"
  ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MerchantClient"
  ADD CONSTRAINT "MerchantClient_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MerchantClient"
  ADD CONSTRAINT "MerchantClient_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
