-- Add methods catalog and merchant assignments
CREATE TABLE "Method" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Method_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Method_code_key" ON "Method"("code");

CREATE TABLE "MerchantMethod" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MerchantMethod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantMethod_merchantId_methodId_key" ON "MerchantMethod"("merchantId", "methodId");

ALTER TABLE "MerchantMethod" ADD CONSTRAINT "MerchantMethod_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantMethod" ADD CONSTRAINT "MerchantMethod_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "Method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
