
> @app/server@ prisma /Users/ekaterinasubramaniam/Downloads/webmanagement-p2p/apps/server
> prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('DEPOSIT', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('TELEGRAM');

-- CreateEnum
CREATE TYPE "NotificationDirection" AS ENUM ('INCOMING', 'OUTGOING', 'BOTH');

-- CreateEnum
CREATE TYPE "MerchantAccountEntryType" AS ENUM ('TOPUP', 'SETTLEMENT');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER', 'ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "MerchantRole" AS ENUM ('OWNER', 'MANAGER', 'ANALYST');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'DEACTIVATED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "FeeKind" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "userDirectoryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "apiKeysSelfServiceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "diditWorkflowId" TEXT,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantApiKey" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "MerchantApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "fullName" TEXT,
    "diditSubject" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "documentType" TEXT,
    "documentNumber" TEXT,
    "documentIssuingState" TEXT,
    "documentIssuingCountry" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "documentExpiry" TIMESTAMP(3),
    "gender" TEXT,
    "address" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "externalSessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT,
    "publicId" VARCHAR(32) NOT NULL DEFAULT 'B' || lpad(nextval('bank_public_id_seq')::text, 4, '0'),
    "currency" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNo" TEXT NOT NULL,
    "iban" TEXT,
    "instructions" TEXT,
    "method" TEXT NOT NULL DEFAULT 'OSKO',
    "label" TEXT,
    "fields" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Method" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Method_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantMethod" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "depositEnabled" BOOLEAN NOT NULL DEFAULT true,
    "withdrawalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptFile" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "original" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentId" TEXT,

    CONSTRAINT "ReceiptFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "chatId" TEXT NOT NULL,
    "direction" "NotificationDirection" NOT NULL DEFAULT 'BOTH',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "type" "PaymentType" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "uniqueReference" TEXT NOT NULL,
    "methodId" TEXT,
    "processedByAdminId" TEXT,
    "processedAt" TIMESTAMP(3),
    "merchantId" TEXT NOT NULL,
    "userId" TEXT,
    "bankAccountId" TEXT,
    "receiptFileId" TEXT,
    "detailsJson" JSONB,
    "rejectedReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WithdrawalDestination" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "currency" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "accountNo" TEXT NOT NULL,
    "iban" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WithdrawalDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantAccountEntry" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "type" "MerchantAccountEntryType" NOT NULL,
    "method" TEXT,
    "amountCents" INTEGER NOT NULL,
    "note" TEXT,
    "receiptFileId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantAccountEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "totpSecret" TEXT,
    "superTwoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "superTotpSecret" TEXT,
    "timezone" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "canViewUserDirectory" BOOLEAN NOT NULL DEFAULT true,
    "canRevealMerchantApiKeys" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminLoginLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT,
    "email" TEXT,
    "success" BOOLEAN NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminLoginLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "ip" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantUser" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "MerchantRole" NOT NULL DEFAULT 'MANAGER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "totpSecret" TEXT,
    "timezone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "canViewUserDirectory" BOOLEAN NOT NULL DEFAULT true,
    "canRevealApiKeys" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MerchantUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantLoginLog" (
    "id" TEXT NOT NULL,
    "merchantUserId" TEXT,
    "email" TEXT,
    "success" BOOLEAN NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantLoginLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantClient" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "userId" TEXT,
    "externalId" TEXT,
    "email" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantLimits" (
    "merchantId" TEXT NOT NULL,
    "maxReqPerMin" INTEGER,
    "ipAllowList" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantLimits_pkey" PRIMARY KEY ("merchantId")
);

-- CreateTable
CREATE TABLE "PayerBlocklist" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT,
    "userId" TEXT,
    "reason" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayerBlocklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminPasswordReset" (
    "id" TEXT NOT NULL,
    "adminId" TEXT,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantPasswordReset" (
    "id" TEXT NOT NULL,
    "merchantUserId" TEXT,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantPasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantApiKeyRevealLog" (
    "id" TEXT NOT NULL,
    "merchantApiKeyId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "merchantUserId" TEXT,
    "adminUserId" TEXT,
    "reason" TEXT,
    "outcome" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantApiKeyRevealLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantFormConfig" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "deposit" JSONB,
    "withdrawal" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantFormConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderPayment" (
    "id" TEXT NOT NULL,
    "paymentRequestId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "methodType" TEXT NOT NULL,
    "bankCode" TEXT,
    "accountNumber" TEXT,
    "accountName" TEXT,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "instructionsJson" JSONB,
    "rawCreateJson" JSONB,
    "rawLatestJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderDisbursement" (
    "id" TEXT NOT NULL,
    "paymentRequestId" TEXT,
    "provider" TEXT NOT NULL,
    "providerPayoutId" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "validationStatus" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "rawCreateJson" JSONB,
    "rawLatestJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderDisbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderWebhookLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "signature" TEXT,
    "headersJson" JSONB,
    "payloadJson" JSONB,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ProviderWebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethodBinding" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "methodType" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "accountNo" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethodBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeRule" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "kind" "FeeKind" NOT NULL,
    "amountCents" INTEGER,
    "percentBps" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantApiKey_prefix_key" ON "MerchantApiKey"("prefix");

-- CreateIndex
CREATE INDEX "MerchantApiKey_merchantId_idx" ON "MerchantApiKey"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_publicId_key" ON "User"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_diditSubject_key" ON "User"("diditSubject");

-- CreateIndex
CREATE UNIQUE INDEX "KycVerification_externalSessionId_key" ON "KycVerification"("externalSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_publicId_key" ON "BankAccount"("publicId");

-- CreateIndex
CREATE INDEX "BankAccount_merchantId_currency_method_active_idx" ON "BankAccount"("merchantId", "currency", "method", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Method_code_key" ON "Method"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantMethod_merchantId_methodId_key" ON "MerchantMethod"("merchantId", "methodId");

-- CreateIndex
CREATE INDEX "ReceiptFile_paymentId_createdAt_idx" ON "ReceiptFile"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationChannel_merchantId_idx" ON "NotificationChannel"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationChannel_merchantId_type_chatId_direction_key" ON "NotificationChannel"("merchantId", "type", "chatId", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_referenceCode_key" ON "PaymentRequest"("referenceCode");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_uniqueReference_key" ON "PaymentRequest"("uniqueReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_receiptFileId_key" ON "PaymentRequest"("receiptFileId");

-- CreateIndex
CREATE INDEX "PaymentRequest_processedByAdminId_idx" ON "PaymentRequest"("processedByAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantAccountEntry_receiptFileId_key" ON "MerchantAccountEntry"("receiptFileId");

-- CreateIndex
CREATE INDEX "MerchantAccountEntry_merchantId_type_createdAt_idx" ON "MerchantAccountEntry"("merchantId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantAccountEntry_createdAt_idx" ON "MerchantAccountEntry"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "AdminLoginLog_adminId_idx" ON "AdminLoginLog"("adminId");

-- CreateIndex
CREATE INDEX "AdminLoginLog_email_idx" ON "AdminLoginLog"("email");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminId_idx" ON "AdminAuditLog"("adminId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantUser_email_key" ON "MerchantUser"("email");

-- CreateIndex
CREATE INDEX "MerchantUser_merchantId_idx" ON "MerchantUser"("merchantId");

-- CreateIndex
CREATE INDEX "MerchantLoginLog_merchantUserId_idx" ON "MerchantLoginLog"("merchantUserId");

-- CreateIndex
CREATE INDEX "MerchantLoginLog_email_idx" ON "MerchantLoginLog"("email");

-- CreateIndex
CREATE INDEX "MerchantClient_merchantId_idx" ON "MerchantClient"("merchantId");

-- CreateIndex
CREATE INDEX "MerchantClient_userId_idx" ON "MerchantClient"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantClient_merchantId_userId_key" ON "MerchantClient"("merchantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantClient_merchantId_externalId_key" ON "MerchantClient"("merchantId", "externalId");

-- CreateIndex
CREATE INDEX "PayerBlocklist_merchantId_idx" ON "PayerBlocklist"("merchantId");

-- CreateIndex
CREATE INDEX "PayerBlocklist_userId_idx" ON "PayerBlocklist"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PayerBlocklist_merchantId_userId_key" ON "PayerBlocklist"("merchantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminPasswordReset_token_key" ON "AdminPasswordReset"("token");

-- CreateIndex
CREATE INDEX "AdminPasswordReset_adminId_idx" ON "AdminPasswordReset"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantPasswordReset_token_key" ON "MerchantPasswordReset"("token");

-- CreateIndex
CREATE INDEX "MerchantPasswordReset_merchantUserId_idx" ON "MerchantPasswordReset"("merchantUserId");

-- CreateIndex
CREATE INDEX "MerchantApiKeyRevealLog_merchantApiKeyId_createdAt_idx" ON "MerchantApiKeyRevealLog"("merchantApiKeyId", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantApiKeyRevealLog_merchantUserId_createdAt_idx" ON "MerchantApiKeyRevealLog"("merchantUserId", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantApiKeyRevealLog_adminUserId_createdAt_idx" ON "MerchantApiKeyRevealLog"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantApiKeyRevealLog_merchantId_createdAt_idx" ON "MerchantApiKeyRevealLog"("merchantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_scope_key_key" ON "IdempotencyKey"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantFormConfig_merchantId_bankAccountId_key" ON "MerchantFormConfig"("merchantId", "bankAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPayment_paymentRequestId_key" ON "ProviderPayment"("paymentRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPayment_providerPaymentId_key" ON "ProviderPayment"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderDisbursement_providerPayoutId_key" ON "ProviderDisbursement"("providerPayoutId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethodBinding_provider_merchantId_userId_methodType__key" ON "PaymentMethodBinding"("provider", "merchantId", "userId", "methodType", "bankCode");

-- CreateIndex
CREATE UNIQUE INDEX "FeeRule_merchantId_methodId_active_key" ON "FeeRule"("merchantId", "methodId", "active");

-- AddForeignKey
ALTER TABLE "MerchantApiKey" ADD CONSTRAINT "MerchantApiKey_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerification" ADD CONSTRAINT "KycVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantMethod" ADD CONSTRAINT "MerchantMethod_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantMethod" ADD CONSTRAINT "MerchantMethod_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "Method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptFile" ADD CONSTRAINT "ReceiptFile_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "Method"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_processedByAdminId_fkey" FOREIGN KEY ("processedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_receiptFileId_fkey" FOREIGN KEY ("receiptFileId") REFERENCES "ReceiptFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalDestination" ADD CONSTRAINT "WithdrawalDestination_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAccountEntry" ADD CONSTRAINT "MerchantAccountEntry_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAccountEntry" ADD CONSTRAINT "MerchantAccountEntry_receiptFileId_fkey" FOREIGN KEY ("receiptFileId") REFERENCES "ReceiptFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAccountEntry" ADD CONSTRAINT "MerchantAccountEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminLoginLog" ADD CONSTRAINT "AdminLoginLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantUser" ADD CONSTRAINT "MerchantUser_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantLoginLog" ADD CONSTRAINT "MerchantLoginLog_merchantUserId_fkey" FOREIGN KEY ("merchantUserId") REFERENCES "MerchantUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantClient" ADD CONSTRAINT "MerchantClient_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantClient" ADD CONSTRAINT "MerchantClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantLimits" ADD CONSTRAINT "MerchantLimits_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerBlocklist" ADD CONSTRAINT "PayerBlocklist_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerBlocklist" ADD CONSTRAINT "PayerBlocklist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPasswordReset" ADD CONSTRAINT "AdminPasswordReset_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantPasswordReset" ADD CONSTRAINT "MerchantPasswordReset_merchantUserId_fkey" FOREIGN KEY ("merchantUserId") REFERENCES "MerchantUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantApiKeyRevealLog" ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantApiKeyId_fkey" FOREIGN KEY ("merchantApiKeyId") REFERENCES "MerchantApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantApiKeyRevealLog" ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantApiKeyRevealLog" ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantUserId_fkey" FOREIGN KEY ("merchantUserId") REFERENCES "MerchantUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantApiKeyRevealLog" ADD CONSTRAINT "MerchantApiKeyRevealLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantFormConfig" ADD CONSTRAINT "MerchantFormConfig_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantFormConfig" ADD CONSTRAINT "MerchantFormConfig_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayment" ADD CONSTRAINT "ProviderPayment_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderDisbursement" ADD CONSTRAINT "ProviderDisbursement_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

