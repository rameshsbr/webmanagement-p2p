-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "totpSecret" TEXT,
ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
