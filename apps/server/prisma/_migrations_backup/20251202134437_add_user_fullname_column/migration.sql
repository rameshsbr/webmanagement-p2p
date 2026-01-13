/*
  Warnings:

  - Made the column `publicId` on table `BankAccount` required. This step will fail if there are existing NULL values in that column.

*/

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'DEACTIVATED', 'BLOCKED');

-- AlterTable (BankAccount)
ALTER TABLE "BankAccount"
  ALTER COLUMN "publicId" SET NOT NULL,
  ALTER COLUMN "publicId" SET DEFAULT 'B' || lpad(nextval('bank_public_id_seq')::text, 4, '0');

-- AlterTable (User)
-- We ONLY add `fullName` here. We DO NOT touch `updatedAt` in this migration,
-- because at this point in history the `updatedAt` column does not exist yet.
ALTER TABLE "User"
  ADD COLUMN "fullName" TEXT;