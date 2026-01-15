-- Add method + label to BankAccount with safe defaults
ALTER TABLE "BankAccount"
  ADD COLUMN IF NOT EXISTS "method" TEXT NOT NULL DEFAULT 'OSKO',
  ADD COLUMN IF NOT EXISTS "label"  TEXT;

-- Helpful index for lookups by merchant/currency/method/active
CREATE INDEX IF NOT EXISTS "BankAccount_m_c_meth_act_idx"
  ON "BankAccount" ("merchantId", "currency", "method", "active");