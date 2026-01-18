-- CreateTable
CREATE TABLE "MonoovaProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientUniqueId" VARCHAR(35) NOT NULL,
  "mProfileId" TEXT,
  "bsb" TEXT,
  "bankAccountNumber" TEXT,
  "bankAccountName" TEXT,
  "status" TEXT,
  "payIdType" TEXT,
  "payIdValue" TEXT,
  "payIdName" TEXT,
  "payIdStatus" TEXT,
  "lastResponse" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MonoovaProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonoovaWebhookInbox" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "bodyJson" JSONB NOT NULL,
  "headersJson" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "linkedUserId" TEXT,
  "linkedRequestId" TEXT,

  CONSTRAINT "MonoovaWebhookInbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonoovaProfile_userId_key" ON "MonoovaProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MonoovaProfile_clientUniqueId_key" ON "MonoovaProfile"("clientUniqueId");

-- CreateIndex
CREATE INDEX "MonoovaProfile_clientUniqueId_idx" ON "MonoovaProfile"("clientUniqueId");

-- CreateIndex
CREATE INDEX "MonoovaWebhookInbox_type_receivedAt_idx" ON "MonoovaWebhookInbox"("type", "receivedAt");

-- CreateIndex
CREATE INDEX "MonoovaWebhookInbox_linkedUserId_idx" ON "MonoovaWebhookInbox"("linkedUserId");

-- CreateIndex
CREATE INDEX "MonoovaWebhookInbox_linkedRequestId_idx" ON "MonoovaWebhookInbox"("linkedRequestId");

-- AddForeignKey
ALTER TABLE "MonoovaProfile" ADD CONSTRAINT "MonoovaProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonoovaWebhookInbox" ADD CONSTRAINT "MonoovaWebhookInbox_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonoovaWebhookInbox" ADD CONSTRAINT "MonoovaWebhookInbox_linkedRequestId_fkey" FOREIGN KEY ("linkedRequestId") REFERENCES "PaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
