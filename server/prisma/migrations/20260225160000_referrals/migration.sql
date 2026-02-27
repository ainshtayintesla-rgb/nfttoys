-- AlterTable
ALTER TABLE "User"
ADD COLUMN "referrerId" TEXT,
ADD COLUMN "referredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_referrerId_referredAt_idx" ON "User"("referrerId", "referredAt");

-- AddForeignKey
ALTER TABLE "User"
ADD CONSTRAINT "User_referrerId_fkey"
FOREIGN KEY ("referrerId") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
