-- Ensure deletes never cascade into historical finance/audit tables
-- Drop any existing foreign keys that might cascade and recreate them with
-- RESTRICT or SET NULL semantics. Nullable columns are loosened where needed
-- so child rows can survive when a parent is removed.

-- Drop potentially cascading foreign keys
ALTER TABLE "MerchantApiKey" DROP CONSTRAINT IF EXISTS "MerchantApiKey_merchantId_fkey";
ALTER TABLE "KycVerification" DROP CONSTRAINT IF EXISTS "KycVerification_userId_fkey";
ALTER TABLE "PaymentRequest" DROP CONSTRAINT IF EXISTS "PaymentRequest_merchantId_fkey";
ALTER TABLE "PaymentRequest" DROP CONSTRAINT IF EXISTS "PaymentRequest_userId_fkey";
ALTER TABLE "PaymentRequest" DROP CONSTRAINT IF EXISTS "PaymentRequest_bankAccountId_fkey";
ALTER TABLE "PaymentRequest" DROP CONSTRAINT IF EXISTS "PaymentRequest_receiptFileId_fkey";
ALTER TABLE "PaymentRequest" DROP CONSTRAINT IF EXISTS "PaymentRequest_processedByAdminId_fkey";
ALTER TABLE "WithdrawalDestination" DROP CONSTRAINT IF EXISTS "WithdrawalDestination_userId_fkey";
ALTER TABLE "LedgerEntry" DROP CONSTRAINT IF EXISTS "LedgerEntry_merchantId_fkey";
ALTER TABLE "MerchantAccountEntry" DROP CONSTRAINT IF EXISTS "MerchantAccountEntry_merchantId_fkey";
ALTER TABLE "MerchantAccountEntry" DROP CONSTRAINT IF EXISTS "MerchantAccountEntry_receiptFileId_fkey";
ALTER TABLE "MerchantAccountEntry" DROP CONSTRAINT IF EXISTS "MerchantAccountEntry_createdById_fkey";
ALTER TABLE "NotificationChannel" DROP CONSTRAINT IF EXISTS "NotificationChannel_merchantId_fkey";
ALTER TABLE "MerchantUser" DROP CONSTRAINT IF EXISTS "MerchantUser_merchantId_fkey";
ALTER TABLE "MerchantLoginLog" DROP CONSTRAINT IF EXISTS "MerchantLoginLog_merchantUserId_fkey";
ALTER TABLE "MerchantPasswordReset" DROP CONSTRAINT IF EXISTS "MerchantPasswordReset_merchantUserId_fkey";
ALTER TABLE "AdminPasswordReset" DROP CONSTRAINT IF EXISTS "AdminPasswordReset_adminId_fkey";
ALTER TABLE "AdminLoginLog" DROP CONSTRAINT IF EXISTS "AdminLoginLog_adminId_fkey";
ALTER TABLE "AdminAuditLog" DROP CONSTRAINT IF EXISTS "AdminAuditLog_adminId_fkey";
ALTER TABLE "MerchantApiKeyRevealLog" DROP CONSTRAINT IF EXISTS "MerchantApiKeyRevealLog_merchantApiKeyId_fkey";
ALTER TABLE "MerchantApiKeyRevealLog" DROP CONSTRAINT IF EXISTS "MerchantApiKeyRevealLog_merchantId_fkey";
ALTER TABLE "MerchantApiKeyRevealLog" DROP CONSTRAINT IF EXISTS "MerchantApiKeyRevealLog_merchantUserId_fkey";
ALTER TABLE "MerchantApiKeyRevealLog" DROP CONSTRAINT IF EXISTS "MerchantApiKeyRevealLog_adminUserId_fkey";
ALTER TABLE "MerchantClient" DROP CONSTRAINT IF EXISTS "MerchantClient_merchantId_fkey";
ALTER TABLE "MerchantClient" DROP CONSTRAINT IF EXISTS "MerchantClient_userId_fkey";
ALTER TABLE "MerchantLimits" DROP CONSTRAINT IF EXISTS "MerchantLimits_merchantId_fkey";
ALTER TABLE "PayerBlocklist" DROP CONSTRAINT IF EXISTS "PayerBlocklist_merchantId_fkey";
ALTER TABLE "PayerBlocklist" DROP CONSTRAINT IF EXISTS "PayerBlocklist_userId_fkey";
ALTER TABLE "BankAccount" DROP CONSTRAINT IF EXISTS "BankAccount_merchantId_fkey";
ALTER TABLE "MerchantFormConfig" DROP CONSTRAINT IF EXISTS "MerchantFormConfig_merchantId_fkey";
ALTER TABLE "MerchantFormConfig" DROP CONSTRAINT IF EXISTS "MerchantFormConfig_bankAccountId_fkey";
ALTER TABLE "ReceiptFile" DROP CONSTRAINT IF EXISTS "ReceiptFile_paymentId_fkey";

-- Allow nullable foreign keys where children must be preserved
ALTER TABLE "KycVerification" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "PaymentRequest" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "PaymentRequest" ALTER COLUMN "bankAccountId" DROP NOT NULL;
ALTER TABLE "PaymentRequest" ALTER COLUMN "receiptFileId" DROP NOT NULL;
ALTER TABLE "PaymentRequest" ALTER COLUMN "processedByAdminId" DROP NOT NULL;
ALTER TABLE "WithdrawalDestination" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "MerchantAccountEntry" ALTER COLUMN "receiptFileId" DROP NOT NULL;
ALTER TABLE "MerchantAccountEntry" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "MerchantLoginLog" ALTER COLUMN "merchantUserId" DROP NOT NULL;
ALTER TABLE "MerchantPasswordReset" ALTER COLUMN "merchantUserId" DROP NOT NULL;
ALTER TABLE "AdminPasswordReset" ALTER COLUMN "adminId" DROP NOT NULL;
ALTER TABLE "AdminLoginLog" ALTER COLUMN "adminId" DROP NOT NULL;
ALTER TABLE "AdminAuditLog" ALTER COLUMN "adminId" DROP NOT NULL;
ALTER TABLE "MerchantApiKeyRevealLog" ALTER COLUMN "merchantUserId" DROP NOT NULL;
ALTER TABLE "MerchantApiKeyRevealLog" ALTER COLUMN "adminUserId" DROP NOT NULL;
ALTER TABLE "MerchantClient" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "PayerBlocklist" ALTER COLUMN "merchantId" DROP NOT NULL;
ALTER TABLE "PayerBlocklist" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "BankAccount" ALTER COLUMN "merchantId" DROP NOT NULL;
ALTER TABLE "MerchantFormConfig" ALTER COLUMN "bankAccountId" DROP NOT NULL;
ALTER TABLE "ReceiptFile" ALTER COLUMN "paymentId" DROP NOT NULL;

-- Recreate foreign keys with RESTRICT / SET NULL semantics
ALTER TABLE "MerchantApiKey"
  ADD CONSTRAINT "MerchantApiKey_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KycVerification"
  ADD CONSTRAINT "KycVerification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_bankAccountId_fkey"
  FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_receiptFileId_fkey"
  FOREIGN KEY ("receiptFileId") REFERENCES "ReceiptFile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_processedByAdminId_fkey"
  FOREIGN KEY ("processedByAdminId") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WithdrawalDestination"
  ADD CONSTRAINT "WithdrawalDestination_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MerchantAccountEntry"
  ADD CONSTRAINT "MerchantAccountEntry_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantAccountEntry"
  ADD CONSTRAINT "MerchantAccountEntry_receiptFileId_fkey"
  FOREIGN KEY ("receiptFileId") REFERENCES "ReceiptFile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MerchantAccountEntry"
  ADD CONSTRAINT "MerchantAccountEntry_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotificationChannel"
  ADD CONSTRAINT "NotificationChannel_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MerchantUser"
  ADD CONSTRAINT "MerchantUser_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MerchantLoginLog"
  ADD CONSTRAINT "MerchantLoginLog_merchantUserId_fkey"
  FOREIGN KEY ("merchantUserId") REFERENCES "MerchantUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MerchantPasswordReset"
  ADD CONSTRAINT "MerchantPasswordReset_merchantUserId_fkey"
  FOREIGN KEY ("merchantUserId") REFERENCES "MerchantUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminPasswordReset"
  ADD CONSTRAINT "AdminPasswordReset_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminLoginLog"
  ADD CONSTRAINT "AdminLoginLog_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminAuditLog"
  ADD CONSTRAINT "AdminAuditLog_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MerchantApiKeyRevealLog"
  ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantApiKeyId_fkey"
  FOREIGN KEY ("merchantApiKeyId") REFERENCES "MerchantApiKey"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantApiKeyRevealLog"
  ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantApiKeyRevealLog"
  ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantUserId_fkey"
  FOREIGN KEY ("merchantUserId") REFERENCES "MerchantUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MerchantApiKeyRevealLog"
  ADD CONSTRAINT "MerchantApiKeyRevealLog_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MerchantClient"
  ADD CONSTRAINT "MerchantClient_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantClient"
  ADD CONSTRAINT "MerchantClient_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MerchantLimits"
  ADD CONSTRAINT "MerchantLimits_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PayerBlocklist"
  ADD CONSTRAINT "PayerBlocklist_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PayerBlocklist"
  ADD CONSTRAINT "PayerBlocklist_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BankAccount"
  ADD CONSTRAINT "BankAccount_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MerchantFormConfig"
  ADD CONSTRAINT "MerchantFormConfig_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantFormConfig"
  ADD CONSTRAINT "MerchantFormConfig_bankAccountId_fkey"
  FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReceiptFile"
  ADD CONSTRAINT "ReceiptFile_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "PaymentRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
