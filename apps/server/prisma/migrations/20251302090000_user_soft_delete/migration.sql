-- Soft-delete support for users + remove cascading delete from payments

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_deletedAt_idx" ON "User"("deletedAt");

-- Replace cascading delete with RESTRICT to preserve history
ALTER TABLE "KycVerification" DROP CONSTRAINT IF EXISTS "KycVerification_userId_fkey";
ALTER TABLE "KycVerification"
  ADD CONSTRAINT "KycVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentRequest" DROP CONSTRAINT IF EXISTS "PaymentRequest_userId_fkey";
ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WithdrawalDestination" DROP CONSTRAINT IF EXISTS "WithdrawalDestination_userId_fkey";
ALTER TABLE "WithdrawalDestination"
  ADD CONSTRAINT "WithdrawalDestination_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MerchantClient" DROP CONSTRAINT IF EXISTS "MerchantClient_userId_fkey";
ALTER TABLE "MerchantClient"
  ADD CONSTRAINT "MerchantClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
