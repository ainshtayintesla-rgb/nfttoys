-- AlterTable
ALTER TABLE "WalletTransaction"
ADD COLUMN "fromAddress" TEXT,
ADD COLUMN "fromFriendly" TEXT,
ADD COLUMN "toAddress" TEXT,
ADD COLUMN "toFriendly" TEXT,
ADD COLUMN "memo" TEXT,
ADD COLUMN "feeAmount" INTEGER,
ADD COLUMN "feeCurrency" TEXT;
