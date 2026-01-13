ALTER TABLE "User" ADD COLUMN "publicId" TEXT;
ALTER TABLE "PaymentRequest" ADD COLUMN "uniqueReference" TEXT;

WITH ordered_users AS (
  SELECT id,
         'U' || LPAD((row_number() OVER (ORDER BY "createdAt"))::text, 6, '0') AS pid
  FROM "User"
)
UPDATE "User" u
SET "publicId" = o.pid
FROM ordered_users o
WHERE u.id = o.id;

ALTER TABLE "User" ALTER COLUMN "publicId" SET NOT NULL;
CREATE UNIQUE INDEX "User_publicId_key" ON "User" ("publicId");

WITH ordered_payments AS (
  SELECT id,
         row_number() OVER (ORDER BY "createdAt") AS rn
  FROM "PaymentRequest"
),
normalized AS (
  SELECT id,
         CASE
           WHEN rn <= 900000 THEN 'T' || LPAD((rn + 9999)::text, 5, '0')
           ELSE 'T' || LPAD((rn + 99999)::text, 6, '0')
         END AS txn_code,
         CASE
           WHEN rn <= 900000 THEN 'UB' || LPAD((rn + 9999)::text, 5, '0')
           ELSE 'UB' || LPAD((rn + 99999)::text, 6, '0')
         END AS unique_ref
  FROM ordered_payments
)
UPDATE "PaymentRequest" p
SET "referenceCode" = n.txn_code,
    "uniqueReference" = n.unique_ref
FROM normalized n
WHERE p.id = n.id;

ALTER TABLE "PaymentRequest" ALTER COLUMN "uniqueReference" SET NOT NULL;
CREATE UNIQUE INDEX "PaymentRequest_uniqueReference_key" ON "PaymentRequest" ("uniqueReference");
