-- Retag non-IDR bank rows that were misclassified as IDR v4 methods.
UPDATE "BankAccount"
SET "method" = 'OSKO'
WHERE "method" IN ('VIRTUAL_BANK_ACCOUNT_DYNAMIC', 'VIRTUAL_BANK_ACCOUNT_STATIC', 'FAZZ_SEND')
  AND UPPER("currency") <> 'IDR';
