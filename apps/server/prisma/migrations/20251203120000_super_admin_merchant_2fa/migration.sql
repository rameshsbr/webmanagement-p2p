-- Add dedicated super admin 2FA columns
ALTER TABLE "AdminUser"
  ADD COLUMN "superTwoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "superTotpSecret" TEXT;

UPDATE "AdminUser"
SET "superTwoFactorEnabled" = COALESCE("twoFactorEnabled", false),
    "superTotpSecret" = "totpSecret"
WHERE UPPER(COALESCE("role", '')) = 'SUPER';
