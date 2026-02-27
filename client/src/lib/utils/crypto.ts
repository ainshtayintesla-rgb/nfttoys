/**
 * Crypto Utilities for Wallet and NFT System
 * Generates wallet addresses, token IDs, and transaction signatures
 */

import crypto from 'crypto';

// Address prefix
const ADDRESS_PREFIX = '0nt';
const NFT_PREFIX = 'NFT';
const FRIENDLY_PREFIX = 'LV-';
const FRIENDLY_BODY_LENGTH = 12;
const FRIENDLY_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const LEGACY_FRIENDLY_REGEX = /^UZ-[A-F0-9]{4}-[A-F0-9]{4}$/i;
const FRIENDLY_REGEX = /^LV-(?!_)(?!.*_.*_)[A-Z0-9_]{12}$/i;

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
    return FRIENDLY_REGEX.test(normalized) || LEGACY_FRIENDLY_REGEX.test(normalized);
}

/**
 * Generate a new wallet address
 * Format: 0nt{64 hex chars}
 * Note: This is a custodial system - no private keys needed.
 * All transactions are signed server-side with TOKEN_SECRET.
 */
export function generateWalletAddress(): {
    address: string;
    addressHash: string;
} {
    // Generate random bytes for unique address
    const randomBytes = crypto.randomBytes(32);
    const timestamp = Date.now().toString();

    // Create address hash from random bytes + timestamp
    const addressHash = crypto
        .createHash('sha256')
        .update(Buffer.concat([randomBytes, Buffer.from(timestamp)]))
        .digest('hex');

    const address = `${ADDRESS_PREFIX}${addressHash}`;

    return {
        address,
        addressHash, // Can be used for additional verification
    };
}

/**
 * Generate user-friendly address from raw address
 * Format: LV-XXXXXXXXXXXX (12 chars, letters/numbers, optional single underscore)
 */
export function toFriendlyAddress(rawAddress: string): string {
    if (!rawAddress.startsWith(ADDRESS_PREFIX)) {
        throw new Error('Invalid address format');
    }

    const hash = rawAddress.slice(ADDRESS_PREFIX.length);
    if (!/^[a-f0-9]{64}$/i.test(hash)) {
        throw new Error('Invalid address format');
    }

    return `${FRIENDLY_PREFIX}${buildFriendlyBody(hash.toLowerCase())}`;
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

        return toFriendlyAddress(rawAddress) === normalized;
    } catch {
        return false;
    }
}

/**
 * Generate unique NFT token ID
 * Format: NFT-{timestamp}-{hash}
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
 * Generate contract address for NFT (simulated)
 * Format: 0nt{hash}
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
        type: 'mint' | 'transfer';
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
        type: 'mint' | 'transfer';
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
