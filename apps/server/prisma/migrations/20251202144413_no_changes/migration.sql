-- AlterTable
ALTER TABLE "BankAccount" ALTER COLUMN "publicId" SET DEFAULT 'B' || lpad(nextval('bank_public_id_seq')::text, 4, '0');

-- AlterTable
ALTER TABLE "MerchantClient" ADD COLUMN     "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "updatedAt" DROP DEFAULT;
