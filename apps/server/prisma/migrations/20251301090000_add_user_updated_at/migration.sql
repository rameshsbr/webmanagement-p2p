-- Ensure User.updatedAt exists with default
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Ensure AdminUser.updatedAt exists with default (legacy safety)
ALTER TABLE "AdminUser"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
