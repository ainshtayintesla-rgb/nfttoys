-- CreateTable
CREATE TABLE "wallets_v2" (
    "id" UUID NOT NULL,
    "user_id" TEXT,
    "mnemonic_hash" TEXT NOT NULL,
    "mnemonic_salt" TEXT NOT NULL,
    "mnemonic_fingerprint" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "pin_salt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_import_at" TIMESTAMPTZ(6),

    CONSTRAINT "wallets_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses_v2" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'main',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addresses_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balances_v2" (
    "wallet_id" UUID NOT NULL,
    "asset" TEXT NOT NULL,
    "available" BIGINT NOT NULL DEFAULT 0,
    "locked" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balances_v2_pkey" PRIMARY KEY ("wallet_id", "asset")
);

-- CreateTable
CREATE TABLE "tx_v2" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "from_address" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "meta" JSONB,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "tx_v2_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tx_v2_amount_check" CHECK ("amount" > 0)
);

-- CreateTable
CREATE TABLE "wallet_sessions_v2" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "user_id" TEXT,
    "device_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "biometric_supported" BOOLEAN NOT NULL DEFAULT false,
    "device_pubkey" TEXT,
    "refresh_token_hash" TEXT NOT NULL,
    "refresh_token_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_ip_hash" TEXT,
    "user_agent" TEXT,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,

    CONSTRAINT "wallet_sessions_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tx_challenges_v2" (
    "id" UUID NOT NULL,
    "tx_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "nonce_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" TIMESTAMPTZ(6),

    CONSTRAINT "tx_challenges_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events_v2" (
    "id" UUID NOT NULL,
    "wallet_id" UUID,
    "user_id" TEXT,
    "event" TEXT NOT NULL,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_v2_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_v2_mnemonic_fingerprint_key" ON "wallets_v2"("mnemonic_fingerprint");

-- CreateIndex
CREATE INDEX "idx_wallets_v2_user_id" ON "wallets_v2"("user_id");

-- CreateIndex
CREATE INDEX "idx_wallets_v2_status" ON "wallets_v2"("status");

-- CreateIndex
CREATE UNIQUE INDEX "addresses_v2_address_key" ON "addresses_v2"("address");

-- CreateIndex
CREATE UNIQUE INDEX "addresses_v2_wallet_id_type_key" ON "addresses_v2"("wallet_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "tx_v2_idempotency_key_key" ON "tx_v2"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_tx_v2_wallet_id_created_at" ON "tx_v2"("wallet_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_tx_v2_status" ON "tx_v2"("status");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_sessions_v2_wallet_id_device_id_status_key" ON "wallet_sessions_v2"("wallet_id", "device_id", "status");

-- CreateIndex
CREATE INDEX "idx_wallet_sessions_v2_wallet_id_status" ON "wallet_sessions_v2"("wallet_id", "status");

-- CreateIndex
CREATE INDEX "idx_wallet_sessions_v2_user_id_status" ON "wallet_sessions_v2"("user_id", "status");

-- CreateIndex
CREATE INDEX "idx_tx_challenges_v2_tx_id" ON "tx_challenges_v2"("tx_id");

-- CreateIndex
CREATE INDEX "idx_tx_challenges_v2_session_id" ON "tx_challenges_v2"("session_id");

-- CreateIndex
CREATE INDEX "idx_audit_events_v2_wallet_id_created_at" ON "audit_events_v2"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_audit_events_v2_user_id_created_at" ON "audit_events_v2"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "wallets_v2"
ADD CONSTRAINT "wallets_v2_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses_v2"
ADD CONSTRAINT "addresses_v2_wallet_id_fkey"
FOREIGN KEY ("wallet_id") REFERENCES "wallets_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balances_v2"
ADD CONSTRAINT "balances_v2_wallet_id_fkey"
FOREIGN KEY ("wallet_id") REFERENCES "wallets_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tx_v2"
ADD CONSTRAINT "tx_v2_wallet_id_fkey"
FOREIGN KEY ("wallet_id") REFERENCES "wallets_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_sessions_v2"
ADD CONSTRAINT "wallet_sessions_v2_wallet_id_fkey"
FOREIGN KEY ("wallet_id") REFERENCES "wallets_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_sessions_v2"
ADD CONSTRAINT "wallet_sessions_v2_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tx_challenges_v2"
ADD CONSTRAINT "tx_challenges_v2_tx_id_fkey"
FOREIGN KEY ("tx_id") REFERENCES "tx_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tx_challenges_v2"
ADD CONSTRAINT "tx_challenges_v2_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "wallet_sessions_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events_v2"
ADD CONSTRAINT "audit_events_v2_wallet_id_fkey"
FOREIGN KEY ("wallet_id") REFERENCES "wallets_v2"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events_v2"
ADD CONSTRAINT "audit_events_v2_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
