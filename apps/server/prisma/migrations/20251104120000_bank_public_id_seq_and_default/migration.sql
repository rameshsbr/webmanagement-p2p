-- 1) Sequence (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'S' AND c.relname = 'bank_public_id_seq'
  ) THEN
    CREATE SEQUENCE bank_public_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
  END IF;
END $$;

-- 2) Align sequence to existing data (never set to 0)
DO $$
DECLARE
  max_num INTEGER;
BEGIN
  SELECT MAX(COALESCE(NULLIF(regexp_replace(publicId, '^B', ''), '')::int, 0))
    INTO max_num
  FROM "BankAccount"
  WHERE publicId IS NOT NULL;

  IF max_num IS NULL OR max_num < 1 THEN
    -- No existing rows in correct format: nextval() should return 1
    PERFORM setval('bank_public_id_seq', 1, false);
  ELSE
    -- Existing rows up to max_num: nextval() should return max_num + 1
    PERFORM setval('bank_public_id_seq', max_num, true);
  END IF;
END $$;

-- 3) Column default (atomic generation)
ALTER TABLE "BankAccount"
  ALTER COLUMN "publicId" SET DEFAULT
  ('B' || lpad(nextval('bank_public_id_seq')::text, 4, '0'));

-- 4) Backfill any existing NULLs using the same generator
UPDATE "BankAccount"
   SET "publicId" = ('B' || lpad(nextval('bank_public_id_seq')::text, 4, '0'))
 WHERE "publicId" IS NULL;

-- 5) Enforce constraints
ALTER TABLE "BankAccount" ALTER COLUMN "publicId" SET NOT NULL;
-- UNIQUE should already exist; keep it. If missing, uncomment:
-- CREATE UNIQUE INDEX IF NOT EXISTS "BankAccount_publicId_key" ON "BankAccount" ("publicId");

-- Optional: format check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bankaccount_publicid_format_chk'
  ) THEN
    ALTER TABLE "BankAccount"
      ADD CONSTRAINT bankaccount_publicid_format_chk
      CHECK (publicId ~ '^B[0-9]+$');
  END IF;
END $$;
