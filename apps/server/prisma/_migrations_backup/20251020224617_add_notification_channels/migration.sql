-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('TELEGRAM');

-- CreateEnum
CREATE TYPE "NotificationDirection" AS ENUM ('INCOMING', 'OUTGOING', 'BOTH');

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

-- CreateIndex
CREATE INDEX "NotificationChannel_merchantId_idx" ON "NotificationChannel"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationChannel_merchantId_type_chatId_direction_key" ON "NotificationChannel"("merchantId", "type", "chatId", "direction");

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
