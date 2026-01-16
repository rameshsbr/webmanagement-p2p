/*
  Warnings:

  - You are about to drop the column `enabled` on the `MerchantApiKey` table. All the data in the column will be lost.
  - You are about to drop the column `publicKey` on the `MerchantApiKey` table. All the data in the column will be lost.
  - You are about to drop the column `secretHash` on the `MerchantApiKey` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[prefix]` on the table `MerchantApiKey` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `last4` to the `MerchantApiKey` table without a default value. This is not possible if the table is not empty.
  - Added the required column `prefix` to the `MerchantApiKey` table without a default value. This is not possible if the table is not empty.
  - Added the required column `secretEnc` to the `MerchantApiKey` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."MerchantApiKey" DROP CONSTRAINT "MerchantApiKey_merchantId_fkey";

-- DropIndex
DROP INDEX "public"."MerchantApiKey_publicKey_key";

-- AlterTable
ALTER TABLE "MerchantApiKey" DROP COLUMN "enabled",
DROP COLUMN "publicKey",
DROP COLUMN "secretHash",
ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "last4" TEXT NOT NULL,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
ADD COLUMN     "prefix" TEXT NOT NULL,
ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "secretEnc" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "MerchantApiKey_prefix_key" ON "MerchantApiKey"("prefix");

-- CreateIndex
CREATE INDEX "MerchantApiKey_merchantId_idx" ON "MerchantApiKey"("merchantId");

-- AddForeignKey
ALTER TABLE "MerchantApiKey" ADD CONSTRAINT "MerchantApiKey_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
