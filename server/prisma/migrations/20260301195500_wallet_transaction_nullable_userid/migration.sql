-- AlterTable
ALTER TABLE "WalletTransaction"
ALTER COLUMN "userId" DROP NOT NULL;

-- DropForeignKey
ALTER TABLE "WalletTransaction"
DROP CONSTRAINT "WalletTransaction_userId_fkey";

-- AddForeignKey
ALTER TABLE "WalletTransaction"
ADD CONSTRAINT "WalletTransaction_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
