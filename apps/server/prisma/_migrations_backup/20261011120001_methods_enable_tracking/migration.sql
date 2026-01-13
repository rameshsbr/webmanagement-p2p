-- Add enabled flag to merchant-method assignments
ALTER TABLE "MerchantMethod" ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN NOT NULL DEFAULT true;

-- Track method link on payments (nullable for legacy rows)
ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "methodId" TEXT;
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "Method"("id") ON DELETE SET NULL ON UPDATE CASCADE;
