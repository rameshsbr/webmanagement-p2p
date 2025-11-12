-- Create sequence for deterministic bank public IDs
CREATE SEQUENCE IF NOT EXISTS "bank_public_id_seq"
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    NO MAXVALUE
    CACHE 1;

-- Use the sequence for new bank accounts (B + zero-padded number)
ALTER TABLE "BankAccount"
  ALTER COLUMN "publicId" SET DEFAULT ('B' || lpad(nextval('bank_public_id_seq')::text, 4, '0'));

-- Backfill any null or legacy identifiers to the new deterministic format
UPDATE "BankAccount"
SET "publicId" = 'B' || lpad(nextval('bank_public_id_seq')::text, 4, '0')
WHERE "publicId" IS NULL OR "publicId" !~ '^B[0-9]+$';

-- Ensure the sequence continues after the highest assigned identifier
SELECT setval(
  'bank_public_id_seq',
  COALESCE(
    (SELECT MAX(CAST(SUBSTRING("publicId", 2) AS INTEGER)) FROM "BankAccount" WHERE "publicId" ~ '^B[0-9]+$'),
    0
  ),
  true
);

-- Enforce NOT NULL constraint now that identifiers are populated
ALTER TABLE "BankAccount"
  ALTER COLUMN "publicId" SET NOT NULL;

-- Keep identifiers predictable (optional format check)
ALTER TABLE "BankAccount"
  ADD CONSTRAINT "BankAccount_publicId_format_check" CHECK ("publicId" ~ '^B[0-9]+$');
