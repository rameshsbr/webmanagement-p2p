-- Disable cascading deletes and allow null foreign keys where history must be preserved

-- Drop existing foreign key constraints
ALTER TABLE "MerchantApiKey" DROP CONSTRAINT "MerchantApiKey_merchantId_fkey";
ALTER TABLE "KycVerification" DROP CONSTRAINT "KycVerification_userId_fkey";
ALTER TABLE "ReceiptFile" DROP CONSTRAINT "ReceiptFile_paymentId_fkey";
ALTER TABLE "NotificationChannel" DROP CONSTRAINT "NotificationChannel_merchantId_fkey";
ALTER TABLE "PaymentRequest" DROP CONSTRAINT "PaymentRequest_merchantId_fkey";
ALTER TABLE "PaymentRequest" DROP CONSTRAINT "PaymentRequest_userId_fkey";
ALTER TABLE "WithdrawalDestination" DROP CONSTRAINT "WithdrawalDestination_userId_fkey";
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_merchantId_fkey";
ALTER TABLE "MerchantAccountEntry" DROP CONSTRAINT "MerchantAccountEntry_merchantId_fkey";
ALTER TABLE "MerchantUser" DROP CONSTRAINT "MerchantUser_merchantId_fkey";
ALTER TABLE "MerchantClient" DROP CONSTRAINT "MerchantClient_merchantId_fkey";
ALTER TABLE "MerchantClient" DROP CONSTRAINT "MerchantClient_userId_fkey";
ALTER TABLE "MerchantLimits" DROP CONSTRAINT "MerchantLimits_merchantId_fkey";
ALTER TABLE "AdminPasswordReset" DROP CONSTRAINT "AdminPasswordReset_adminId_fkey";
ALTER TABLE "MerchantPasswordReset" DROP CONSTRAINT "MerchantPasswordReset_merchantUserId_fkey";
ALTER TABLE "MerchantApiKeyRevealLog" DROP CONSTRAINT "MerchantApiKeyRevealLog_merchantApiKeyId_fkey";
ALTER TABLE "MerchantApiKeyRevealLog" DROP CONSTRAINT "MerchantApiKeyRevealLog_merchantId_fkey";
ALTER TABLE "MerchantFormConfig" DROP CONSTRAINT "MerchantFormConfig_merchantId_fkey";
ALTER TABLE "MerchantFormConfig" DROP CONSTRAINT "MerchantFormConfig_bankAccountId_fkey";

-- Allow nullable foreign keys where children should remain after parent deletion
ALTER TABLE "KycVerification" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "PaymentRequest" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "WithdrawalDestination" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "MerchantClient" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "AdminPasswordReset" ALTER COLUMN "adminId" DROP NOT NULL;
ALTER TABLE "MerchantPasswordReset" ALTER COLUMN "merchantUserId" DROP NOT NULL;

-- Recreate foreign keys with safe delete behaviors
ALTER TABLE "MerchantApiKey" ADD CONSTRAINT "MerchantApiKey_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KycVerification" ADD CONSTRAINT "KycVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReceiptFile" ADD CONSTRAINT "ReceiptFile_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WithdrawalDestination" ADD CONSTRAINT "WithdrawalDestination_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantAccountEntry" ADD CONSTRAINT "MerchantAccountEntry_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantUser" ADD CONSTRAINT "MerchantUser_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantClient" ADD CONSTRAINT "MerchantClient_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantClient" ADD CONSTRAINT "MerchantClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MerchantLimits" ADD CONSTRAINT "MerchantLimits_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminPasswordReset" ADD CONSTRAINT "AdminPasswordReset_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MerchantPasswordReset" ADD CONSTRAINT "MerchantPasswordReset_merchantUserId_fkey" FOREIGN KEY ("merchantUserId") REFERENCES "MerchantUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MerchantApiKeyRevealLog" ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantApiKeyId_fkey" FOREIGN KEY ("merchantApiKeyId") REFERENCES "MerchantApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantApiKeyRevealLog" ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantFormConfig" ADD CONSTRAINT "MerchantFormConfig_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantFormConfig" ADD CONSTRAINT "MerchantFormConfig_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
