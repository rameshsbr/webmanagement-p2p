ALTER TABLE "AdminUser"
  ADD COLUMN "canViewUserDirectory" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "MerchantUser"
  ADD COLUMN "canViewUserDirectory" BOOLEAN NOT NULL DEFAULT true;
