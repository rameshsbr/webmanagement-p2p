-- Unify client directory into MerchantClient table
DROP TABLE IF EXISTS "MerchantClientMapping";
DROP TABLE IF EXISTS "MerchantClient";

CREATE TABLE "MerchantClient" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalId" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MerchantClient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantClient_merchantId_userId_key" ON "MerchantClient"("merchantId", "userId");
CREATE UNIQUE INDEX "MerchantClient_merchantId_externalId_key" ON "MerchantClient"("merchantId", "externalId");
CREATE INDEX "MerchantClient_merchantId_idx" ON "MerchantClient"("merchantId");
CREATE INDEX "MerchantClient_userId_idx" ON "MerchantClient"("userId");

ALTER TABLE "MerchantClient" ADD CONSTRAINT "MerchantClient_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantClient" ADD CONSTRAINT "MerchantClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
