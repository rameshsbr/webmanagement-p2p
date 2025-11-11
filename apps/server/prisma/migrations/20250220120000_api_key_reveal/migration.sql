-- Add permission flags and reveal logs
ALTER TABLE "MerchantUser"
  ADD COLUMN IF NOT EXISTS "canRevealApiKeys" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "AdminUser"
  ADD COLUMN IF NOT EXISTS "canRevealMerchantApiKeys" BOOLEAN NOT NULL DEFAULT false;

UPDATE "MerchantUser"
  SET "canRevealApiKeys" = TRUE
  WHERE UPPER("role") = 'OWNER';

UPDATE "AdminUser"
  SET "canRevealMerchantApiKeys" = TRUE
  WHERE UPPER("role") = 'SUPER';

CREATE TABLE IF NOT EXISTS "MerchantApiKeyRevealLog" (
  "id" TEXT PRIMARY KEY,
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
  CONSTRAINT "MerchantApiKeyRevealLog_key_fkey"
    FOREIGN KEY ("merchantApiKeyId") REFERENCES "MerchantApiKey"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MerchantApiKeyRevealLog_merchant_fkey"
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MerchantApiKeyRevealLog_merchantUser_fkey"
    FOREIGN KEY ("merchantUserId") REFERENCES "MerchantUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MerchantApiKeyRevealLog_adminUser_fkey"
    FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "MerchantApiKeyRevealLog_key_createdAt_idx"
  ON "MerchantApiKeyRevealLog"("merchantApiKeyId", "createdAt");
CREATE INDEX IF NOT EXISTS "MerchantApiKeyRevealLog_merchantUser_idx"
  ON "MerchantApiKeyRevealLog"("merchantUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "MerchantApiKeyRevealLog_adminUser_idx"
  ON "MerchantApiKeyRevealLog"("adminUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "MerchantApiKeyRevealLog_merchant_idx"
  ON "MerchantApiKeyRevealLog"("merchantId", "createdAt");
