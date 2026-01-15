-- Add global limit columns to Method
ALTER TABLE "Method"
  ADD COLUMN "depositMinAmountCents" INTEGER,
  ADD COLUMN "depositMaxAmountCents" INTEGER,
  ADD COLUMN "withdrawMinAmountCents" INTEGER,
  ADD COLUMN "withdrawMaxAmountCents" INTEGER;
