/*
  Warnings:

  - The primary key for the `MerchantFormConfig` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[merchantId,bankAccountId]` on the table `MerchantFormConfig` will be added. If there are existing duplicate values, this will fail.
  - The required column `id` was added to the `MerchantFormConfig` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- AlterTable
ALTER TABLE "MerchantFormConfig" DROP CONSTRAINT "MerchantFormConfig_pkey",
ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "MerchantFormConfig_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantFormConfig_merchantId_bankAccountId_key" ON "MerchantFormConfig"("merchantId", "bankAccountId");

-- AddForeignKey
ALTER TABLE "MerchantFormConfig" ADD CONSTRAINT "MerchantFormConfig_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
