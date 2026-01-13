-- CreateTable
CREATE TABLE "MerchantClient" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "diditSubject" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantClient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantClient_diditSubject_key" ON "MerchantClient"("diditSubject");
CREATE UNIQUE INDEX "MerchantClient_merchantId_externalId_key" ON "MerchantClient"("merchantId", "externalId");
CREATE INDEX "MerchantClient_userId_idx" ON "MerchantClient"("userId");

-- AddForeignKey
ALTER TABLE "MerchantClient" ADD CONSTRAINT "MerchantClient_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantClient" ADD CONSTRAINT "MerchantClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
