-- CreateTable
CREATE TABLE "nft_staking_v2" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "token_id" TEXT NOT NULL,
    "user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "reward_per_hour" BIGINT NOT NULL DEFAULT 0,
    "staked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_claim_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unstaked_at" TIMESTAMPTZ(6),
    "total_claimed" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nft_staking_v2_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "nft_staking_v2_reward_per_hour_check" CHECK ("reward_per_hour" >= 0),
    CONSTRAINT "nft_staking_v2_total_claimed_check" CHECK ("total_claimed" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "nft_staking_v2_token_id_key" ON "nft_staking_v2"("token_id");

-- CreateIndex
CREATE INDEX "idx_nft_staking_v2_wallet_id_status_staked_at" ON "nft_staking_v2"("wallet_id", "status", "staked_at");

-- CreateIndex
CREATE INDEX "idx_nft_staking_v2_user_id_status" ON "nft_staking_v2"("user_id", "status");

-- AddForeignKey
ALTER TABLE "nft_staking_v2"
ADD CONSTRAINT "nft_staking_v2_wallet_id_fkey"
FOREIGN KEY ("wallet_id") REFERENCES "wallets_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nft_staking_v2"
ADD CONSTRAINT "nft_staking_v2_token_id_fkey"
FOREIGN KEY ("token_id") REFERENCES "Nft"("tokenId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nft_staking_v2"
ADD CONSTRAINT "nft_staking_v2_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
