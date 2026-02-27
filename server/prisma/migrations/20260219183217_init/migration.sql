-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" INTEGER,
    "firstName" TEXT,
    "lastName" TEXT,
    "username" TEXT,
    "usernameLower" TEXT,
    "photoUrl" TEXT,
    "languageCode" TEXT,
    "walletAddress" TEXT,
    "walletFriendly" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "address" TEXT NOT NULL,
    "friendlyAddress" TEXT NOT NULL,
    "userId" TEXT,
    "addressHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "balance" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "QrCode" (
    "nfcId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "rarity" TEXT NOT NULL,
    "tgsFile" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "usedBy" TEXT,
    "usedByName" TEXT,
    "usedByPhoto" TEXT,
    "usedByFirstName" TEXT,

    CONSTRAINT "QrCode_pkey" PRIMARY KEY ("nfcId")
);

-- CreateTable
CREATE TABLE "Nft" (
    "tokenId" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "ownerWallet" TEXT,
    "ownerId" TEXT,
    "modelName" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "rarity" TEXT NOT NULL,
    "tgsFile" TEXT NOT NULL,
    "qrCodeId" TEXT,
    "mintedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "metadata" JSONB,
    "lastTransferAt" TIMESTAMP(3),

    CONSTRAINT "Nft_pkey" PRIMARY KEY ("tokenId")
);

-- CreateTable
CREATE TABLE "NftHistory" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "wallet" TEXT,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "fromWallet" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NftHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "from" TEXT,
    "fromUserId" TEXT,
    "to" TEXT,
    "toUserId" TEXT,
    "tokenId" TEXT,
    "modelName" TEXT,
    "serialNumber" TEXT,
    "signature" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "User_usernameLower_key" ON "User"("usernameLower");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_friendlyAddress_key" ON "Wallet"("friendlyAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "QrCode_serialNumber_key" ON "QrCode"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "QrCode_token_key" ON "QrCode"("token");

-- CreateIndex
CREATE INDEX "QrCode_createdAt_idx" ON "QrCode"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Nft_contractAddress_key" ON "Nft"("contractAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Nft_qrCodeId_key" ON "Nft"("qrCodeId");

-- CreateIndex
CREATE INDEX "Nft_ownerId_idx" ON "Nft"("ownerId");

-- CreateIndex
CREATE INDEX "Nft_ownerWallet_idx" ON "Nft"("ownerWallet");

-- CreateIndex
CREATE INDEX "NftHistory_tokenId_timestamp_idx" ON "NftHistory"("tokenId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_txHash_key" ON "Transaction"("txHash");

-- CreateIndex
CREATE INDEX "Transaction_tokenId_timestamp_idx" ON "Transaction"("tokenId", "timestamp");

-- CreateIndex
CREATE INDEX "Transaction_fromUserId_timestamp_idx" ON "Transaction"("fromUserId", "timestamp");

-- CreateIndex
CREATE INDEX "Transaction_toUserId_timestamp_idx" ON "Transaction"("toUserId", "timestamp");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nft" ADD CONSTRAINT "Nft_qrCodeId_fkey" FOREIGN KEY ("qrCodeId") REFERENCES "QrCode"("nfcId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nft" ADD CONSTRAINT "Nft_ownerWallet_fkey" FOREIGN KEY ("ownerWallet") REFERENCES "Wallet"("address") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nft" ADD CONSTRAINT "Nft_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NftHistory" ADD CONSTRAINT "NftHistory_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Nft"("tokenId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NftHistory" ADD CONSTRAINT "NftHistory_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "Wallet"("address") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NftHistory" ADD CONSTRAINT "NftHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_from_fkey" FOREIGN KEY ("from") REFERENCES "Wallet"("address") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_to_fkey" FOREIGN KEY ("to") REFERENCES "Wallet"("address") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Nft"("tokenId") ON DELETE SET NULL ON UPDATE CASCADE;
