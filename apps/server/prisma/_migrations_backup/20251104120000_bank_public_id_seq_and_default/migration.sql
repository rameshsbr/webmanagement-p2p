-- Ensure BankAccount.publicId exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'BankAccount'
      AND column_name = 'publicId'
  ) THEN
    ALTER TABLE "BankAccount" ADD COLUMN "publicId" VARCHAR(32);
  END IF;
END $$;

-- Ensure sequence exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'bank_public_id_seq'
  ) THEN
    CREATE SEQUENCE bank_public_id_seq START 1;
  END IF;
END $$;

-- Set default for new rows
ALTER TABLE "BankAccount"
  ALTER COLUMN "publicId"
  SET DEFAULT ('B' || lpad(nextval('bank_public_id_seq')::text, 4, '0'));

-- Backfill existing rows (if any)
UPDATE "BankAccount"
SET "publicId" = ('B' || lpad(nextval('bank_public_id_seq')::text, 4, '0'))
WHERE "publicId" IS NULL OR "publicId" = '';

-- Make the sequence owned by the column (safe even if already set)
ALTER SEQUENCE bank_public_id_seq OWNED BY "BankAccount"."publicId";

-- Add uniqueness if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BankAccount_publicId_key'
  ) THEN
    ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_publicId_key" UNIQUE ("publicId");
  END IF;
END $$;
