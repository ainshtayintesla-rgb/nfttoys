-- CreateTable: NFT Story Shares для streak-бонусов стейкинга
CREATE TABLE "nft_story_shares" (
    "id"           UUID        NOT NULL,
    "wallet_id"    UUID        NOT NULL,
    "token_id"     TEXT        NOT NULL,
    "user_id"      TEXT,
    "shared_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bonus_amount" BIGINT      NOT NULL DEFAULT 0,
    "streak_day"   INTEGER     NOT NULL DEFAULT 1,
    "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nft_story_shares_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "nft_story_shares_bonus_amount_check" CHECK ("bonus_amount" >= 0),
    CONSTRAINT "nft_story_shares_streak_day_check" CHECK ("streak_day" >= 1)
);

-- Indexes
CREATE INDEX "idx_nft_story_shares_wallet_id_shared_at"
    ON "nft_story_shares"("wallet_id", "shared_at" DESC);

CREATE INDEX "idx_nft_story_shares_token_id_shared_at"
    ON "nft_story_shares"("token_id", "shared_at" DESC);

CREATE INDEX "idx_nft_story_shares_user_id_shared_at"
    ON "nft_story_shares"("user_id", "shared_at" DESC);

-- ForeignKeys
ALTER TABLE "nft_story_shares"
    ADD CONSTRAINT "nft_story_shares_wallet_id_fkey"
    FOREIGN KEY ("wallet_id") REFERENCES "wallets_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "nft_story_shares"
    ADD CONSTRAINT "nft_story_shares_token_id_fkey"
    FOREIGN KEY ("token_id") REFERENCES "Nft"("tokenId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "nft_story_shares"
    ADD CONSTRAINT "nft_story_shares_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
