-- CreateTable
CREATE TABLE "admin_accounts" (
    "id" TEXT NOT NULL,
    "telegram_id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(6),

    CONSTRAINT "admin_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_accounts_telegram_id_key" ON "admin_accounts"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_accounts_login_key" ON "admin_accounts"("login");
