/**
 * Crypto Utilities for Wallet and NFT System
 */

import crypto from 'crypto';

const ADDRESS_PREFIX = '0nt';
const NFT_PREFIX = 'NFT';
const FRIENDLY_MAINNET_PREFIX = 'LV-';
const FRIENDLY_TESTNET_PREFIX = 'tLV-';
const FRIENDLY_BODY_LENGTH = 30;
const FRIENDLY_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const LEGACY_FRIENDLY_REGEX = /^UZ-[A-F0-9]{4}-[A-F0-9]{4}$/i;
const FRIENDLY_BODY_PATTERN = `[A-Z0-9_]{${FRIENDLY_BODY_LENGTH}}`;
const FRIENDLY_BODY_REGEX = new RegExp(`^${FRIENDLY_BODY_PATTERN}$`);
const FRIENDLY_ANY_REGEX = new RegExp(`^(LV|tLV)-(?!_)(?!.*_.*_)(${FRIENDLY_BODY_PATTERN})$`, 'i');
const ZERO_ADDRESS_HASH = '0'.repeat(64);
const TREASURY_ADDRESS_HASH = 'f'.repeat(64);

export type WalletNetwork = 'mainnet' | 'testnet';

function resolveWalletNetwork(): WalletNetwork {
    const configured = process.env.WALLET_NETWORK?.trim().toLowerCase();

    if (configured === 'mainnet' || configured === 'testnet') {
        return configured;
    }

    if (process.env.NODE_ENV === 'production') {
        return 'mainnet';
    }

    return 'testnet';
}

const walletNetwork = resolveWalletNetwork();

function resolveFriendlyPrefix(network: WalletNetwork = walletNetwork): string {
    return network === 'testnet' ? FRIENDLY_TESTNET_PREFIX : FRIENDLY_MAINNET_PREFIX;
}

function parseFriendlyBody(value: string): string | null {
    const normalized = value.trim().replace(/\s+/g, '');
    const match = normalized.match(FRIENDLY_ANY_REGEX);

    if (!match) {
        return null;
    }

    const body = (match[2] || '').toUpperCase();
    return FRIENDLY_BODY_REGEX.test(body) ? body : null;
}

export function getWalletNetwork(): WalletNetwork {
    return walletNetwork;
}

export function getFriendlyAddressPrefix(network: WalletNetwork = walletNetwork): string {
    return resolveFriendlyPrefix(network);
}

export function getFriendlyAddressRegex(network: WalletNetwork = walletNetwork): RegExp {
    if (network === 'testnet') {
        return new RegExp(`^tLV-(?!_)(?!.*_.*_)${FRIENDLY_BODY_PATTERN}$`);
    }

    return new RegExp(`^LV-(?!_)(?!.*_.*_)${FRIENDLY_BODY_PATTERN}$`);
}

export function normalizeFriendlyAddressForNetwork(
    value: string,
    network: WalletNetwork = walletNetwork,
): string | null {
    const body = parseFriendlyBody(value);

    if (!body) {
        return null;
    }

    return `${resolveFriendlyPrefix(network)}${body}`;
}

export function buildFriendlyAddressCandidates(
    value: string,
    network: WalletNetwork = walletNetwork,
): string[] {
    const body = parseFriendlyBody(value);

    if (!body) {
        return [];
    }

    const primaryPrefix = resolveFriendlyPrefix(network);
    const fallbackPrefix = primaryPrefix === FRIENDLY_TESTNET_PREFIX
        ? FRIENDLY_MAINNET_PREFIX
        : FRIENDLY_TESTNET_PREFIX;

    return [`${primaryPrefix}${body}`, `${fallbackPrefix}${body}`];
}

export function isFriendlyAddressInput(value: string): boolean {
    return /^(LV-|tLV-|UZ-)/i.test(value.trim());
}

export const ZERO_ADDRESS = `${ADDRESS_PREFIX}${ZERO_ADDRESS_HASH}`;
export const ZERO_FRIENDLY_ADDRESS = `${resolveFriendlyPrefix()}${'0'.repeat(FRIENDLY_BODY_LENGTH)}`;
export const TREASURY_ADDRESS = `${ADDRESS_PREFIX}${TREASURY_ADDRESS_HASH}`;
export const TREASURY_FRIENDLY_ADDRESS = `${resolveFriendlyPrefix()}${buildFriendlyBody(TREASURY_ADDRESS_HASH)}`;

function buildFriendlyBody(addressHash: string): string {
    const seed = crypto
        .createHash('sha256')
        .update(addressHash)
        .digest();

    const chars = Array.from({ length: FRIENDLY_BODY_LENGTH }, (_, index) => (
        FRIENDLY_CHARSET[seed[index] % FRIENDLY_CHARSET.length]
    ));

    // Allow at most one underscore, never at first position after LV-.
    if ((seed[12] & 1) === 1) {
        const underscoreIndex = (seed[13] % (FRIENDLY_BODY_LENGTH - 1)) + 1;
        chars[underscoreIndex] = '_';
    }

    return chars.join('');
}

function toLegacyFriendlyAddress(rawAddress: string): string {
    const hash = rawAddress.slice(ADDRESS_PREFIX.length);
    const short = hash.slice(0, 4).toUpperCase();
    const checksum = hash.slice(-4).toUpperCase();

    return `UZ-${short}-${checksum}`;
}

export function isFriendlyAddress(value: string): boolean {
    const normalized = value.trim().toUpperCase();
    return FRIENDLY_ANY_REGEX.test(normalized) || LEGACY_FRIENDLY_REGEX.test(normalized);
}

/**
 * Generate a new wallet address
 */
export function generateWalletAddress(): {
    address: string;
    addressHash: string;
} {
    const randomBytes = crypto.randomBytes(32);
    const timestamp = Date.now().toString();

    const addressHash = crypto
        .createHash('sha256')
        .update(Buffer.concat([randomBytes, Buffer.from(timestamp)]))
        .digest('hex');

    const address = `${ADDRESS_PREFIX}${addressHash}`;

    return { address, addressHash };
}

/**
 * Generate user-friendly address
 */
export function toFriendlyAddress(rawAddress: string): string {
    if (!rawAddress.startsWith(ADDRESS_PREFIX)) {
        throw new Error('Invalid address format');
    }

    const hash = rawAddress.slice(ADDRESS_PREFIX.length);
    if (!/^[a-f0-9]{64}$/i.test(hash)) {
        throw new Error('Invalid address format');
    }

    if (rawAddress.toLowerCase() === ZERO_ADDRESS) {
        return ZERO_FRIENDLY_ADDRESS;
    }

    return `${resolveFriendlyPrefix()}${buildFriendlyBody(hash.toLowerCase())}`;
}

/**
 * Check if friendly address matches raw address
 */
export function matchesFriendlyAddress(rawAddress: string, friendlyAddress: string): boolean {
    try {
        const normalized = friendlyAddress.trim().toUpperCase();
        if (!isFriendlyAddress(normalized)) {
            return false;
        }

        if (LEGACY_FRIENDLY_REGEX.test(normalized)) {
            return toLegacyFriendlyAddress(rawAddress) === normalized;
        }

        if (!rawAddress.startsWith(ADDRESS_PREFIX)) {
            return false;
        }

        const hash = rawAddress.slice(ADDRESS_PREFIX.length);
        if (!/^[a-f0-9]{64}$/i.test(hash)) {
            return false;
        }

        const inputBody = parseFriendlyBody(normalized);
        if (!inputBody) {
            return false;
        }

        return buildFriendlyBody(hash.toLowerCase()) === inputBody;
    } catch {
        return false;
    }
}

/**
 * Generate unique NFT token ID
 */
export function generateTokenId(
    modelName: string,
    serialNumber: number,
    salt?: string
): string {
    const timestamp = Date.now();
    const data = `${modelName}:${serialNumber}:${timestamp}:${salt || crypto.randomBytes(16).toString('hex')}`;

    const hash = crypto
        .createHash('sha256')
        .update(data)
        .digest('hex')
        .slice(0, 16);

    return `${NFT_PREFIX}-${timestamp}-${hash}`;
}

/**
 * Generate contract address for NFT
 */
export function generateContractAddress(tokenId: string): string {
    const hash = crypto
        .createHash('sha256')
        .update(`contract:${tokenId}`)
        .digest('hex');

    return `${ADDRESS_PREFIX}${hash}`;
}

/**
 * Sign a transaction with server secret
 */
export function signTransaction(
    txData: {
        type: 'mint' | 'transfer' | 'burn';
        from: string | null;
        to: string;
        tokenId: string;
        timestamp: number;
    },
    secret: string
): string {
    const payload = JSON.stringify(txData);

    return crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
}

/**
 * Verify transaction signature
 */
export function verifyTransactionSignature(
    txData: {
        type: 'mint' | 'transfer' | 'burn';
        from: string | null;
        to: string;
        tokenId: string;
        timestamp: number;
    },
    signature: string,
    secret: string
): boolean {
    const expectedSignature = signTransaction(txData, secret);

    return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
    );
}

/**
 * Generate transaction hash
 */
export function generateTxHash(
    type: string,
    from: string | null,
    to: string,
    tokenId: string,
    timestamp: number
): string {
    const data = `${type}:${from || 'null'}:${to}:${tokenId}:${timestamp}`;

    return `0x${crypto.createHash('sha256').update(data).digest('hex')}`;
}

/**
 * Validate address format
 */
export function isValidAddress(address: string): boolean {
    if (!address.startsWith(ADDRESS_PREFIX)) return false;
    const hash = address.slice(ADDRESS_PREFIX.length);
    return /^[a-f0-9]{64}$/i.test(hash);
}

/**
 * Validate token ID format
 */
export function isValidTokenId(tokenId: string): boolean {
    return /^NFT-\d+-[a-f0-9]{16}$/i.test(tokenId);
}
