-- DropIndex
DROP INDEX IF EXISTS "User_phone_key";

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "address" TEXT,
  ADD COLUMN "dateOfBirth" TIMESTAMP(3),
  ADD COLUMN "documentExpiry" TIMESTAMP(3),
  ADD COLUMN "documentIssuingCountry" TEXT,
  ADD COLUMN "documentIssuingState" TEXT,
  ADD COLUMN "documentNumber" TEXT,
  ADD COLUMN "documentType" TEXT,
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "gender" TEXT,
  ADD COLUMN "lastName" TEXT,
  ALTER COLUMN "diditSubject" DROP NOT NULL;
