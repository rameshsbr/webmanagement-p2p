CREATE TABLE "ProviderPaymentMethod" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "bankCode" TEXT NOT NULL,
  "providerPaymentMethodId" TEXT NOT NULL,
  "accountNo" TEXT,
  "accountName" TEXT,
  "displayName" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "metaJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProviderPaymentMethod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderPaymentMethod_providerPaymentMethodId_key" ON "ProviderPaymentMethod"("providerPaymentMethodId");

CREATE INDEX "ProviderPaymentMethod_provider_type_merchantId_userId_bankCode_idx" ON "ProviderPaymentMethod"("provider", "type", "merchantId", "userId", "bankCode");

ALTER TABLE "ProviderPaymentMethod" ADD CONSTRAINT "ProviderPaymentMethod_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderPaymentMethod" ADD CONSTRAINT "ProviderPaymentMethod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
