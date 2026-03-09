-- AlterTable: Add story boost fields to nft_story_shares
ALTER TABLE "nft_story_shares" ADD COLUMN IF NOT EXISTS "telegram_id" TEXT;
ALTER TABLE "nft_story_shares" ADD COLUMN IF NOT EXISTS "boost_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.4;
ALTER TABLE "nft_story_shares" ADD COLUMN IF NOT EXISTS "boost_expires_at" TIMESTAMPTZ(6);
ALTER TABLE "nft_story_shares" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "nft_story_shares" ADD COLUMN IF NOT EXISTS "verification_code" TEXT;
ALTER TABLE "nft_story_shares" ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMPTZ(6);
ALTER TABLE "nft_story_shares" ADD COLUMN IF NOT EXISTS "revoked_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_nft_story_shares_telegram_id_status" ON "nft_story_shares"("telegram_id", "status");

-- CreateTable
CREATE TABLE IF NOT EXISTS "userbot_sessions" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "session_string" TEXT,
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "error_message" TEXT,
    "last_active_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "userbot_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "userbot_sessions_phone_key" ON "userbot_sessions"("phone");
