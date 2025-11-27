-- Prevent bank-level form configs from cascading delete
ALTER TABLE "MerchantFormConfig" DROP CONSTRAINT IF EXISTS "MerchantFormConfig_bankAccountId_fkey";

-- Ensure FK allows null so dependent rows survive parent deletion
ALTER TABLE "MerchantFormConfig" ALTER COLUMN "bankAccountId" DROP NOT NULL;

ALTER TABLE "MerchantFormConfig"
  ADD CONSTRAINT "MerchantFormConfig_bankAccountId_fkey"
  FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
