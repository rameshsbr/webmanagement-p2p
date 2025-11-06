ALTER TABLE "BankAccount" ADD COLUMN "publicId" TEXT;

WITH ordered_banks AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY "createdAt", id) AS rn
  FROM "BankAccount"
),
normalized AS (
  SELECT id,
         CASE
           WHEN rn <= 9000 THEN 'BI' || LPAD(rn::text, 4, '0')
           ELSE 'BI' || LPAD(rn::text, 5, '0')
         END AS public_id
  FROM ordered_banks
)
UPDATE "BankAccount" b
SET "publicId" = n.public_id
FROM normalized n
WHERE b.id = n.id;

ALTER TABLE "BankAccount" ALTER COLUMN "publicId" SET NOT NULL;
CREATE UNIQUE INDEX "BankAccount_publicId_key" ON "BankAccount" ("publicId");
