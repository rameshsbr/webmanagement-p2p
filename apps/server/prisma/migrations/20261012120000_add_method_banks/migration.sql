-- Create method-scoped bank configuration table
CREATE TABLE "MethodBank" (
  "id" TEXT NOT NULL,
  "methodId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sort" INTEGER NOT NULL DEFAULT 1000,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MethodBank_pkey" PRIMARY KEY ("id")
);

-- Unique constraint to prevent duplicate codes per method
CREATE UNIQUE INDEX "MethodBank_methodId_code_key" ON "MethodBank"("methodId", "code");

-- Sorting support
CREATE INDEX "MethodBank_methodId_sort_idx" ON "MethodBank"("methodId", "sort");

-- Foreign key back to Method
ALTER TABLE "MethodBank"
ADD CONSTRAINT "MethodBank_methodId_fkey"
FOREIGN KEY ("methodId") REFERENCES "Method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
