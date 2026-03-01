-- AlterTable
ALTER TABLE "WalletTransaction"
ADD COLUMN "requestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_requestId_key" ON "WalletTransaction"("requestId");
