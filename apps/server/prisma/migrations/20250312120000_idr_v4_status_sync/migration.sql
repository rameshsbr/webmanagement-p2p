-- Add normalized status columns for FAZZ sync
ALTER TABLE "ProviderPayment" ADD COLUMN "normalizedStatus" TEXT;
ALTER TABLE "ProviderDisbursement" ADD COLUMN "normalizedStatus" TEXT;

-- Webhook dedupe key
ALTER TABLE "ProviderWebhookLog" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "ProviderWebhookLog_dedupeKey_key" ON "ProviderWebhookLog"("dedupeKey");
