-- DropForeignKey
ALTER TABLE "public"."MerchantApiKey" DROP CONSTRAINT "MerchantApiKey_merchantId_fkey";

-- AddForeignKey
ALTER TABLE "MerchantApiKey" ADD CONSTRAINT "MerchantApiKey_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "BankAccount_m_c_meth_act_idx" RENAME TO "BankAccount_merchantId_currency_method_active_idx";
