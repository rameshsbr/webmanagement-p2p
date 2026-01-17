-- Create KYC re-verification request tracking table
CREATE TABLE "KycReverifyRequest" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "diditSubject" TEXT,
  "requestedByAdminId" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clearedAt" TIMESTAMP(3),

  CONSTRAINT "KycReverifyRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KycReverifyRequest_merchantId_idx" ON "KycReverifyRequest"("merchantId");
CREATE INDEX "KycReverifyRequest_userId_idx" ON "KycReverifyRequest"("userId");
CREATE INDEX "KycReverifyRequest_diditSubject_idx" ON "KycReverifyRequest"("diditSubject");
CREATE INDEX "KycReverifyRequest_merchantId_userId_idx" ON "KycReverifyRequest"("merchantId", "userId");

ALTER TABLE "KycReverifyRequest"
ADD CONSTRAINT "KycReverifyRequest_merchantId_fkey"
FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KycReverifyRequest"
ADD CONSTRAINT "KycReverifyRequest_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KycReverifyRequest"
ADD CONSTRAINT "KycReverifyRequest_requestedByAdminId_fkey"
FOREIGN KEY ("requestedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
