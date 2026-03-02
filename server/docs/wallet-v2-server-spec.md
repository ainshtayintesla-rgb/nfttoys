# Wallet V2 Server Specification (Final)

Date: 2026-03-02  
Project: `nfttoys-dev`  
Scope: Backend-only (`/v2` API + DB + security controls), no UI work

## 1. Locked Product Decisions

1. Mnemonic standard: BIP-39, exactly 24 words.
2. No BIP-39 passphrase ("25th word") in V2.
3. Operation auth: Face ID / Touch ID when available, otherwise PIN.
4. Address format: one unified internal format for all assets.
5. Platform model: centralized ledger, no real on-chain private keys in V2.

## 2. Security Invariants

1. Mnemonic/seed must never be logged (app logs, audit logs, errors, traces).
2. Mnemonic is only used in RAM during `create`/`import`.
3. Persist mnemonic only as `argon2id hash + salt + pepper`.
4. Persist PIN only as `argon2id hash + salt + pepper`.
5. Biometric data never leaves device; server stores only device public key (for signature verification) or session metadata.
6. Recovery on new device: import by 24 words, then set a new PIN.

## 3. Address and Amount Standards

1. Unified address regex: `^LV-[0-9A-HJKMNP-TV-Z]{12}$`.
2. Address generation: random Crockford Base32 body, uppercase, collision-safe via DB unique constraint.
3. Amounts are stored as integer minor units (`BIGINT`) and serialized as strings in API responses.

## 4. Data Model

## 4.1 Core Tables (Required)

### `wallets_v2`
- `id` UUID PK
- `user_id` TEXT NULL (owner link from existing auth domain)
- `mnemonic_hash` TEXT NOT NULL
- `mnemonic_salt` TEXT NOT NULL
- `mnemonic_fingerprint` TEXT NOT NULL UNIQUE
- `pin_hash` TEXT NOT NULL
- `pin_salt` TEXT NOT NULL
- `status` TEXT NOT NULL DEFAULT `'active'` (`active|blocked|deleted`)
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- `updated_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- `last_import_at` TIMESTAMPTZ NULL

Indexes:
- `idx_wallets_v2_user_id` on (`user_id`)
- `idx_wallets_v2_status` on (`status`)

### `addresses_v2`
- `id` UUID PK
- `wallet_id` UUID NOT NULL FK -> `wallets_v2.id`
- `address` TEXT NOT NULL UNIQUE
- `type` TEXT NOT NULL DEFAULT `'main'`
- `status` TEXT NOT NULL DEFAULT `'active'` (`active|archived`)
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()

Constraints:
- unique (`wallet_id`, `type`) for single main address in V2

### `balances_v2`
- `wallet_id` UUID NOT NULL FK -> `wallets_v2.id`
- `asset` TEXT NOT NULL
- `available` BIGINT NOT NULL DEFAULT 0
- `locked` BIGINT NOT NULL DEFAULT 0
- `updated_at` TIMESTAMPTZ NOT NULL DEFAULT now()

Primary key:
- (`wallet_id`, `asset`)

### `tx_v2`
- `id` UUID PK
- `wallet_id` UUID NOT NULL FK -> `wallets_v2.id` (initiator wallet)
- `from_address` TEXT NOT NULL
- `to_address` TEXT NOT NULL
- `asset` TEXT NOT NULL
- `amount` BIGINT NOT NULL CHECK (`amount > 0`)
- `status` TEXT NOT NULL (`created|pending_confirmation|confirmed|completed|failed|canceled`)
- `meta` JSONB NULL
- `idempotency_key` TEXT NULL UNIQUE
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- `confirmed_at` TIMESTAMPTZ NULL
- `completed_at` TIMESTAMPTZ NULL

Indexes:
- `idx_tx_v2_wallet_id_created_at` on (`wallet_id`, `created_at` desc)
- `idx_tx_v2_status` on (`status`)

## 4.2 Security/Session Tables (Required for V2 Controls)

### `wallet_sessions_v2`
- `id` UUID PK
- `wallet_id` UUID NOT NULL FK -> `wallets_v2.id`
- `user_id` TEXT NULL
- `device_id` TEXT NOT NULL
- `platform` TEXT NOT NULL (`ios|android|web`)
- `biometric_supported` BOOLEAN NOT NULL DEFAULT false
- `device_pubkey` TEXT NULL
- `refresh_token_hash` TEXT NOT NULL
- `refresh_token_expires_at` TIMESTAMPTZ NOT NULL
- `status` TEXT NOT NULL DEFAULT `'active'` (`active|revoked`)
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- `last_seen_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- `last_ip_hash` TEXT NULL
- `user_agent` TEXT NULL
- `revoked_at` TIMESTAMPTZ NULL
- `revoked_reason` TEXT NULL

Constraints:
- unique (`wallet_id`, `device_id`, `status`) for one active session per device

Indexes:
- `idx_wallet_sessions_v2_wallet_id_status` on (`wallet_id`, `status`)
- `idx_wallet_sessions_v2_user_id_status` on (`user_id`, `status`)

### `tx_challenges_v2`
- `id` UUID PK
- `tx_id` UUID NOT NULL FK -> `tx_v2.id`
- `session_id` UUID NOT NULL FK -> `wallet_sessions_v2.id`
- `nonce_hash` TEXT NOT NULL
- `status` TEXT NOT NULL DEFAULT `'active'` (`active|consumed|expired|canceled`)
- `expires_at` TIMESTAMPTZ NOT NULL
- `attempts` INT NOT NULL DEFAULT 0
- `max_attempts` INT NOT NULL DEFAULT 5
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- `consumed_at` TIMESTAMPTZ NULL

### `audit_events_v2`
- `id` UUID PK
- `wallet_id` UUID NULL
- `user_id` TEXT NULL
- `event` TEXT NOT NULL
- `ip_hash` TEXT NULL
- `user_agent` TEXT NULL
- `meta` JSONB NULL (strictly no secrets)
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()

## 5. Cryptography Requirements

1. Mnemonic normalization before hash:
- trim
- lowercase
- collapse internal spaces to single space
- Unicode NFKD

2. `argon2id` baseline:
- memory cost: `65536` (64 MB)
- time cost: `3`
- parallelism: `1`
- output length: `32`

3. Pepper:
- from env (`WALLET_V2_PEPPER`)
- rotate via versioned pepper strategy (`pepper_version` optional column)

4. Fingerprint:
- `mnemonic_fingerprint = hex(HMAC_SHA256(FINGERPRINT_PEPPER, mnemonic_normalized))[0..31]`
- fingerprint is for candidate lookup only; final verification must use full argon2id hash check.

## 6. API Contract (`/v2`)

Common:
- Content-Type: `application/json`
- Auth for private routes: Bearer access token from wallet session
- Error format:
```json
{
  "success": false,
  "error": {
    "code": "INVALID_PIN",
    "message": "PIN is invalid"
  }
}
```

Success format:
```json
{
  "success": true,
  "data": {}
}
```

## 6.1 `POST /v2/wallet/create`

Creates a wallet and returns mnemonic exactly once.

Request:
```json
{
  "pin": "1234",
  "device": {
    "deviceId": "ios-uuid",
    "platform": "ios",
    "biometricSupported": true,
    "devicePubKey": "base64url-ed25519-pubkey"
  }
}
```

Response `201`:
```json
{
  "success": true,
  "data": {
    "wallet": {
      "id": "0e6cfe1b-348f-4ef3-a5ac-2b170af8e6e7",
      "address": "LV-7Q9M4F2K8T1R",
      "status": "active",
      "createdAt": "2026-03-02T15:30:00.000Z"
    },
    "mnemonic": [
      "word1", "word2", "word3", "word4", "word5", "word6",
      "word7", "word8", "word9", "word10", "word11", "word12",
      "word13", "word14", "word15", "word16", "word17", "word18",
      "word19", "word20", "word21", "word22", "word23", "word24"
    ],
    "session": {
      "accessToken": "jwt",
      "refreshToken": "opaque-token",
      "expiresInSec": 3600
    }
  }
}
```

Rules:
1. Mnemonic is never returned again after this response.
2. If wallet already exists for `user_id`, return `409 WALLET_ALREADY_EXISTS`.

## 6.2 `POST /v2/wallet/import`

Imports wallet by mnemonic and creates/restores access on the current device.  
For recovery, user sets a new PIN.

Request:
```json
{
  "mnemonic": [
    "word1", "word2", "word3", "word4", "word5", "word6",
    "word7", "word8", "word9", "word10", "word11", "word12",
    "word13", "word14", "word15", "word16", "word17", "word18",
    "word19", "word20", "word21", "word22", "word23", "word24"
  ],
  "newPin": "5678",
  "device": {
    "deviceId": "ios-uuid-new",
    "platform": "ios",
    "biometricSupported": true,
    "devicePubKey": "base64url-ed25519-pubkey"
  }
}
```

Response `200`:
```json
{
  "success": true,
  "data": {
    "wallet": {
      "id": "0e6cfe1b-348f-4ef3-a5ac-2b170af8e6e7",
      "address": "LV-7Q9M4F2K8T1R",
      "status": "active"
    },
    "session": {
      "accessToken": "jwt",
      "refreshToken": "opaque-token",
      "expiresInSec": 3600
    }
  }
}
```

Rules:
1. Exactly 24 valid BIP-39 words required.
2. On success, PIN hash is replaced with `newPin` hash.
3. Failed imports are rate-limited and audited without storing mnemonic.

Errors:
- `401 INVALID_MNEMONIC`
- `423 WALLET_BLOCKED`
- `429 IMPORT_RATE_LIMITED`

## 6.3 `POST /v2/session/refresh`

Rotates refresh token and returns a new token pair for the same active device session.

Request:
```json
{
  "refreshToken": "opaque-token",
  "deviceId": "ios-uuid"
}
```

Response `200`:
```json
{
  "success": true,
  "data": {
    "session": {
      "accessToken": "jwt",
      "refreshToken": "opaque-token-v2",
      "expiresInSec": 3600
    }
  }
}
```

Errors:
- `401 INVALID_REFRESH_TOKEN`
- `409 DEVICE_MISMATCH`
- `423 SESSION_REVOKED`

## 6.4 `POST /v2/session/logout`

Revokes current wallet session (current device).

Request:
```json
{
  "refreshToken": "opaque-token"
}
```

Response `200`:
```json
{
  "success": true,
  "data": {
    "revoked": true
  }
}
```

## 6.5 `GET /v2/sessions`

Returns active/recent device sessions for current wallet.

Response `200`:
```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "id": "8f9f7b0f-85b3-44f2-8fc2-3d1618776504",
        "deviceId": "ios-uuid",
        "platform": "ios",
        "biometricSupported": true,
        "status": "active",
        "createdAt": "2026-03-02T10:00:00.000Z",
        "lastSeenAt": "2026-03-02T12:30:00.000Z",
        "isCurrent": true
      }
    ]
  }
}
```

## 6.6 `POST /v2/sessions/revoke`

Revokes another device session for current wallet.

Request:
```json
{
  "sessionId": "8f9f7b0f-85b3-44f2-8fc2-3d1618776504"
}
```

Response `200`:
```json
{
  "success": true,
  "data": {
    "revoked": true
  }
}
```

Rules:
1. Current session cannot revoke itself via this endpoint; use `/v2/session/logout`.
2. Revoked session cannot refresh or confirm transactions anymore.

## 6.7 `GET /v2/wallet/:id/balance`

Returns wallet balances.

Response `200`:
```json
{
  "success": true,
  "data": {
    "walletId": "0e6cfe1b-348f-4ef3-a5ac-2b170af8e6e7",
    "address": "LV-7Q9M4F2K8T1R",
    "balances": [
      {
        "asset": "UZS",
        "available": "100000",
        "locked": "0",
        "updatedAt": "2026-03-02T15:40:00.000Z"
      }
    ]
  }
}
```

## 6.8 `POST /v2/tx/create`

Creates an internal transaction and reserves sender balance.

Request:
```json
{
  "walletId": "0e6cfe1b-348f-4ef3-a5ac-2b170af8e6e7",
  "toAddress": "LV-F4H9N2Q7R8KM",
  "asset": "UZS",
  "amount": "25000",
  "meta": {
    "comment": "gift"
  },
  "idempotencyKey": "3dbdbf1f-ea7c-47a1-af0f-31bb9ef85a53"
}
```

Response `201`:
```json
{
  "success": true,
  "data": {
    "tx": {
      "id": "f7a5f58a-2ef8-4af9-b241-d64c0679ff22",
      "status": "pending_confirmation",
      "fromAddress": "LV-7Q9M4F2K8T1R",
      "toAddress": "LV-F4H9N2Q7R8KM",
      "asset": "UZS",
      "amount": "25000",
      "createdAt": "2026-03-02T15:45:00.000Z"
    },
    "challenge": {
      "challengeId": "fbb4d796-7cf4-4a28-8462-f5db0bbf2df6",
      "expiresAt": "2026-03-02T15:50:00.000Z",
      "methods": ["biometric", "pin"]
    }
  }
}
```

Rules:
1. Move `amount` from `available` to `locked` on create.
2. Use DB transaction + row lock to avoid double spend.
3. Idempotency key is mandatory for client retries.

## 6.9 `POST /v2/tx/confirm`

Confirms and executes a pending internal transaction.

Biometric request:
```json
{
  "txId": "f7a5f58a-2ef8-4af9-b241-d64c0679ff22",
  "challengeId": "fbb4d796-7cf4-4a28-8462-f5db0bbf2df6",
  "auth": {
    "method": "biometric",
    "deviceId": "ios-uuid",
    "signature": "base64url-signature"
  }
}
```

PIN request:
```json
{
  "txId": "f7a5f58a-2ef8-4af9-b241-d64c0679ff22",
  "challengeId": "fbb4d796-7cf4-4a28-8462-f5db0bbf2df6",
  "auth": {
    "method": "pin",
    "pin": "5678"
  }
}
```

Response `200`:
```json
{
  "success": true,
  "data": {
    "tx": {
      "id": "f7a5f58a-2ef8-4af9-b241-d64c0679ff22",
      "status": "completed",
      "completedAt": "2026-03-02T15:46:00.000Z"
    }
  }
}
```

Execution rules:
1. Validate challenge, session, and auth method.
2. If biometric: verify signature against registered `device_pubkey`.
3. If PIN: verify `argon2id(pin + pepper)` against stored hash.
4. Atomic ledger apply:
- sender `locked -= amount`
- recipient `available += amount`
- tx `status = completed`
5. On failure, set tx `failed` and release locked funds when applicable.

## 7. Rate Limit and Anti-Bruteforce

1. `POST /v2/wallet/import`:
- 5 attempts / 15 min per `ip + deviceId`
- 20 attempts / 24 h per hashed mnemonic fingerprint
- exponential backoff on repeated failures

2. `POST /v2/tx/confirm` with PIN:
- max 5 failed PIN attempts per challenge/session
- after limit: challenge invalidated, tx canceled, locked funds released

3. Session and auth endpoints:
- `POST /v2/session/refresh`: 10 requests / 5 min per session
- `POST /v2/session/logout`: 20 requests / 5 min per session
- `POST /v2/sessions/revoke`: 20 requests / 5 min per wallet

4. Global API rate limit per IP and per wallet session.

## 8. Audit and Logging

1. Audit events required:
- wallet created
- wallet import success/failure
- session created/revoked
- tx created
- tx confirmed/failed/canceled

2. Never log:
- mnemonic words
- PIN
- full signatures/tokens

3. Allowed: hashes, IDs, status transitions, timestamps, non-secret metadata.

## 9. Minimal V2 Environment Variables

- `WALLET_V2_PEPPER`
- `WALLET_V2_FINGERPRINT_PEPPER`
- `WALLET_V2_ACCESS_TOKEN_SECRET`
- `WALLET_V2_REFRESH_TOKEN_SECRET`
- `WALLET_V2_IMPORT_RATE_LIMIT_REDIS_URL`

## 10. Acceptance Criteria

1. Wallet create returns 24-word mnemonic once and never again.
2. Import works by mnemonic hash verification only (no plaintext storage).
3. Recovery on new device resets PIN successfully.
4. Tx confirmation works via biometric signature or PIN fallback.
5. Unified address format is enforced for all assets.
6. No secrets appear in logs or audit payloads.
7. Double spend is prevented under concurrent requests.
8. Device session list/revoke/refresh works and blocks revoked devices from further access.

## 11. Out of Scope (V2)

1. Real blockchain key custody/signing.
2. BIP-39 passphrase support.
3. Cross-chain address derivation logic.
