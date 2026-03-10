-- Repair production schema drift where the code expects telegram_story_id
-- but the original story boost migration did not add the column.
ALTER TABLE "nft_story_shares"
    ADD COLUMN IF NOT EXISTS "telegram_story_id" INTEGER;
