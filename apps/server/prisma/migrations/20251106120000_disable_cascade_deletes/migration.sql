-- Disable cascading deletes and allow null foreign keys where history must be preserved

-- Drop existing foreign key constraints for tables we expect to exist
ALTER TABLE "MerchantApiKey"        DROP CONSTRAINT IF EXISTS "MerchantApiKey_merchantId_fkey";
ALTER TABLE "KycVerification"       DROP CONSTRAINT IF EXISTS "KycVerification_userId_fkey";
ALTER TABLE "ReceiptFile"           DROP CONSTRAINT IF EXISTS "ReceiptFile_paymentId_fkey";
ALTER TABLE "NotificationChannel"   DROP CONSTRAINT IF EXISTS "NotificationChannel_merchantId_fkey";
ALTER TABLE "PaymentRequest"        DROP CONSTRAINT IF EXISTS "PaymentRequest_merchantId_fkey";
ALTER TABLE "PaymentRequest"        DROP CONSTRAINT IF EXISTS "PaymentRequest_userId_fkey";
ALTER TABLE "WithdrawalDestination" DROP CONSTRAINT IF EXISTS "WithdrawalDestination_userId_fkey";
ALTER TABLE "LedgerEntry"           DROP CONSTRAINT IF EXISTS "LedgerEntry_merchantId_fkey";
ALTER TABLE "MerchantUser"          DROP CONSTRAINT IF EXISTS "MerchantUser_merchantId_fkey";
ALTER TABLE "MerchantLimits"        DROP CONSTRAINT IF EXISTS "MerchantLimits_merchantId_fkey";
ALTER TABLE "AdminPasswordReset"    DROP CONSTRAINT IF EXISTS "AdminPasswordReset_adminId_fkey";
ALTER TABLE "MerchantPasswordReset" DROP CONSTRAINT IF EXISTS "MerchantPasswordReset_merchantUserId_fkey";
ALTER TABLE "MerchantFormConfig"    DROP CONSTRAINT IF EXISTS "MerchantFormConfig_merchantId_fkey";
ALTER TABLE "MerchantFormConfig"    DROP CONSTRAINT IF EXISTS "MerchantFormConfig_bankAccountId_fkey";
-- NOTE: MerchantAccountEntry, MerchantClient, MerchantApiKeyRevealLog are handled
-- in guarded DO $$ blocks below so we don't crash if those tables are missing.

------------------------------------------------------------
-- Guarded block: MerchantAccountEntry (may not exist)
------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('"MerchantAccountEntry"') IS NOT NULL THEN
    ALTER TABLE "MerchantAccountEntry"
      DROP CONSTRAINT IF EXISTS "MerchantAccountEntry_merchantId_fkey";
  END IF;
END $$;

------------------------------------------------------------
-- Guarded block: MerchantClient (may not exist yet)
------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('"MerchantClient"') IS NOT NULL THEN
    -- Drop old FKs (if present)
    ALTER TABLE "MerchantClient"
      DROP CONSTRAINT IF EXISTS "MerchantClient_merchantId_fkey";
    ALTER TABLE "MerchantClient"
      DROP CONSTRAINT IF EXISTS "MerchantClient_userId_fkey";

    -- Allow nullable foreign key where children should remain
    ALTER TABLE "MerchantClient"
      ALTER COLUMN "userId" DROP NOT NULL;

    -- Recreate FKs with safe delete behaviour
    ALTER TABLE "MerchantClient"
      ADD CONSTRAINT "MerchantClient_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;

    ALTER TABLE "MerchantClient"
      ADD CONSTRAINT "MerchantClient_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

------------------------------------------------------------
-- Guarded block: MerchantApiKeyRevealLog (may not exist anymore)
------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('"MerchantApiKeyRevealLog"') IS NOT NULL THEN
    -- Drop existing FKs if they exist
    ALTER TABLE "MerchantApiKeyRevealLog"
      DROP CONSTRAINT IF EXISTS "MerchantApiKeyRevealLog_merchantApiKeyId_fkey";
    ALTER TABLE "MerchantApiKeyRevealLog"
      DROP CONSTRAINT IF EXISTS "MerchantApiKeyRevealLog_merchantId_fkey";

    -- Recreate FKs with safe behaviours
    ALTER TABLE "MerchantApiKeyRevealLog"
      ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantApiKeyId_fkey"
      FOREIGN KEY ("merchantApiKeyId") REFERENCES "MerchantApiKey"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;

    ALTER TABLE "MerchantApiKeyRevealLog"
      ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

------------------------------------------------------------
-- Allow nullable foreign keys for history tables
------------------------------------------------------------
ALTER TABLE "KycVerification"       ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "PaymentRequest"        ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "WithdrawalDestination" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "AdminPasswordReset"    ALTER COLUMN "adminId" DROP NOT NULL;
ALTER TABLE "MerchantPasswordReset" ALTER COLUMN "merchantUserId" DROP NOT NULL;

------------------------------------------------------------
-- Recreate foreign keys with safe delete behaviors
------------------------------------------------------------

ALTER TABLE "MerchantApiKey"
  ADD CONSTRAINT "MerchantApiKey_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KycVerification"
  ADD CONSTRAINT "KycVerification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReceiptFile"
  ADD CONSTRAINT "ReceiptFile_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "PaymentRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotificationChannel"
  ADD CONSTRAINT "NotificationChannel_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WithdrawalDestination"
  ADD CONSTRAINT "WithdrawalDestination_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Re-add MerchantAccountEntry FK only if table exists
DO $$
BEGIN
  IF to_regclass('"MerchantAccountEntry"') IS NOT NULL THEN
    ALTER TABLE "MerchantAccountEntry"
      ADD CONSTRAINT "MerchantAccountEntry_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "MerchantUser"
  ADD CONSTRAINT "MerchantUser_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MerchantLimits"
  ADD CONSTRAINT "MerchantLimits_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdminPasswordReset"
  ADD CONSTRAINT "AdminPasswordReset_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MerchantPasswordReset"
  ADD CONSTRAINT "MerchantPasswordReset_merchantUserId_fkey"
  FOREIGN KEY ("merchantUserId") REFERENCES "MerchantUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MerchantFormConfig"
  ADD CONSTRAINT "MerchantFormConfig_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MerchantFormConfig"
  ADD CONSTRAINT "MerchantFormConfig_bankAccountId_fkey"
  FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;