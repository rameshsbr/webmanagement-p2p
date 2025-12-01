-- Add per-merchant Didit KYC workflow ID
ALTER TABLE "Merchant" ADD COLUMN "diditWorkflowId" TEXT;
