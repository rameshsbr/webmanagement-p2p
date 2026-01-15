ALTER TABLE "Method"
  ALTER COLUMN "depositMinAmountCents"  TYPE BIGINT USING "depositMinAmountCents"::bigint,
  ALTER COLUMN "depositMaxAmountCents"  TYPE BIGINT USING "depositMaxAmountCents"::bigint,
  ALTER COLUMN "withdrawMinAmountCents" TYPE BIGINT USING "withdrawMinAmountCents"::bigint,
  ALTER COLUMN "withdrawMaxAmountCents" TYPE BIGINT USING "withdrawMaxAmountCents"::bigint;
