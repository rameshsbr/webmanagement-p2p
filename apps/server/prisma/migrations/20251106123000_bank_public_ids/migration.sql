-- Ensure BankAccount.publicId column exists
ALTER TABLE "BankAccount" ADD COLUMN IF NOT EXISTS "publicId" VARCHAR(32);

-- Ensure sequence exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'bank_public_id_seq'
  ) THEN
    CREATE SEQUENCE bank_public_id_seq START 1;
  END IF;
END $$;

-- Default for new rows
ALTER TABLE "BankAccount"
  ALTER COLUMN "publicId"
  SET DEFAULT ('B' || lpad(nextval('bank_public_id_seq')::text, 4, '0'));

-- Backfill null/empty values (safe to run repeatedly)
UPDATE "BankAccount"
SET "publicId" = ('B' || lpad(nextval('bank_public_id_seq')::text, 4, '0'))
WHERE ("publicId" IS NULL OR "publicId" = '');

-- Own sequence (safe even if already set)
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
