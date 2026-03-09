import {
    getWalletV2AddressPrefix,
    getWalletV2AddressRegex,
    getWalletV2Network,
    WALLET_V2_ADDRESS_BODY_LENGTH,
} from '../../lib/walletV2/security';

export const DEFAULT_ASSET = 'UZS';
export const VALID_ASSET_REGEX = /^[A-Z0-9_]{2,16}$/;
export const VALID_IDEMPOTENCY_KEY_REGEX = /^[a-zA-Z0-9._:-]{8,128}$/;
export const REFRESH_TOKEN_TTL_SEC = Number.parseInt(process.env.WALLET_V2_REFRESH_TOKEN_TTL_SEC || '', 10) || 60 * 60 * 24 * 30;
export const CHALLENGE_TTL_SEC = Number.parseInt(process.env.WALLET_V2_CHALLENGE_TTL_SEC || '', 10) || 60 * 5;

export const WALLET_V2_NETWORK = getWalletV2Network();
export const WALLET_V2_ADDRESS_PREFIX = getWalletV2AddressPrefix(WALLET_V2_NETWORK);
export const WALLET_V2_ADDRESS_REGEX_CURRENT = getWalletV2AddressRegex(WALLET_V2_NETWORK);
export const WALLET_V2_ADDRESS_PLACEHOLDER_BODY = 'X'.repeat(WALLET_V2_ADDRESS_BODY_LENGTH);
export const WALLET_V2_TESTNET_FAUCET_ADDRESS = `${WALLET_V2_ADDRESS_PREFIX}-${'F'.repeat(WALLET_V2_ADDRESS_BODY_LENGTH)}`;
export const WALLET_V2_STAKING_REWARD_SOURCE_ADDRESS = `${WALLET_V2_ADDRESS_PREFIX}-${'S'.repeat(WALLET_V2_ADDRESS_BODY_LENGTH)}`;
export const WALLET_V2_TESTNET_TOPUP_MAX_AMOUNT = 1_000_000_000n;

export const MAX_WALLETS_PER_USER = 10;

export const NFT_STAKING_REWARD_ASSET = DEFAULT_ASSET;
export const NFT_STAKING_UNSTAKE_COOLDOWN_HOURS = Math.max(
    1,
    Number.parseInt(process.env.WALLET_V2_NFT_STAKING_UNSTAKE_COOLDOWN_HOURS || '', 10) || 24,
);
export const NFT_STAKING_WINDOW_START_HOURS = Math.max(
    1,
    Number.parseInt(process.env.WALLET_V2_NFT_STAKING_WINDOW_START_HOURS || '', 10) || 24,
);
export const NFT_STAKING_WINDOW_END_HOURS = Math.max(
    NFT_STAKING_WINDOW_START_HOURS + 1,
    Number.parseInt(process.env.WALLET_V2_NFT_STAKING_WINDOW_END_HOURS || '', 10) || 48,
);
export const NFT_STAKING_REWARD_PER_HOUR_BY_RARITY: Record<string, bigint> = {
    legendary: 120n,
    rare: 60n,
    common: 30n,
};
export const NFT_STAKING_DEFAULT_REWARD_PER_HOUR = 20n;
export const DEFAULT_COLLECTION_NAME = 'Plush pepe';

export const IMPORT_FINGERPRINT_LIMIT_PER_DAY = 20;
export const IMPORT_FINGERPRINT_WINDOW_MS = 24 * 60 * 60 * 1000;

export const PIN_VERIFY_MAX_FAILURES = 5;
export const PIN_VERIFY_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

export const NFT_STORY_SHARE_COOLDOWN_HOURS = 20;
export const NFT_STORY_SHARE_REVOKED_COOLDOWN_HOURS = 1 / 60;
export const NFT_STORY_SHARE_STREAK_WINDOW_HOURS = 48;
export const NFT_STORY_SHARE_MAX_STREAK_MULTIPLIER = 7;
