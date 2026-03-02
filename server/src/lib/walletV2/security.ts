import argon2 from 'argon2';
import * as bip39 from 'bip39';
import crypto from 'crypto';

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MNEMONIC_WORD_COUNT = 24;
const SALT_BYTES = 16;
const REFRESH_TOKEN_BYTES = 48;
const CHALLENGE_NONCE_BYTES = 32;

const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
};

export const WALLET_V2_ADDRESS_REGEX = /^LV-[0-9A-HJKMNP-TV-Z]{12}$/;

function requiredEnv(name: string): string {
    const value = process.env[name]?.trim();

    if (!value) {
        throw new Error(`${name} is not configured`);
    }

    return value;
}

function normalizeMnemonicPhrase(phrase: string): string {
    return phrase
        .normalize('NFKD')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

export function parseAndNormalizeMnemonicInput(rawMnemonic: unknown): { words: string[]; normalized: string } | null {
    if (!Array.isArray(rawMnemonic) || rawMnemonic.length !== MNEMONIC_WORD_COUNT) {
        return null;
    }

    const words = rawMnemonic.map((word) => (typeof word === 'string' ? word.trim().toLowerCase() : ''));

    if (words.some((word) => !word)) {
        return null;
    }

    const normalized = normalizeMnemonicPhrase(words.join(' '));

    if (!bip39.validateMnemonic(normalized)) {
        return null;
    }

    return {
        words: normalized.split(' '),
        normalized,
    };
}

export function generateMnemonic24Words(): { words: string[]; normalized: string } {
    const phrase = bip39.generateMnemonic(256);
    const normalized = normalizeMnemonicPhrase(phrase);

    return {
        words: normalized.split(' '),
        normalized,
    };
}

function randomCrockfordBody(length: number): string {
    return Array.from({ length }, () => CROCKFORD_BASE32[crypto.randomInt(0, CROCKFORD_BASE32.length)]).join('');
}

export function generateAddressV2(): string {
    return `LV-${randomCrockfordBody(12)}`;
}

export function generateOpaqueRefreshToken(): string {
    return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

export function generateSalt(): string {
    return crypto.randomBytes(SALT_BYTES).toString('base64url');
}

export function generateChallengeNonce(): string {
    return crypto.randomBytes(CHALLENGE_NONCE_BYTES).toString('base64url');
}

export function hashRefreshToken(refreshToken: string): string {
    const secret = requiredEnv('WALLET_V2_REFRESH_TOKEN_SECRET');

    return crypto
        .createHmac('sha256', secret)
        .update(refreshToken)
        .digest('hex');
}

export function hashIpAddress(ip: string | undefined): string | null {
    if (!ip || !ip.trim()) {
        return null;
    }

    const pepper = requiredEnv('WALLET_V2_PEPPER');

    return crypto
        .createHash('sha256')
        .update(`${pepper}:${ip.trim()}`)
        .digest('hex');
}

export function mnemonicFingerprint(normalizedMnemonic: string): string {
    const pepper = requiredEnv('WALLET_V2_FINGERPRINT_PEPPER');

    return crypto
        .createHmac('sha256', pepper)
        .update(normalizedMnemonic)
        .digest('hex')
        .slice(0, 32);
}

function composeSecretPayload(secret: string, salt: string): string {
    const pepper = requiredEnv('WALLET_V2_PEPPER');
    return `${secret}:${salt}:${pepper}`;
}

export async function hashSecret(secret: string, salt: string): Promise<string> {
    return argon2.hash(composeSecretPayload(secret, salt), ARGON2_OPTIONS);
}

export async function verifySecret(hash: string, secret: string, salt: string): Promise<boolean> {
    try {
        return await argon2.verify(hash, composeSecretPayload(secret, salt), ARGON2_OPTIONS);
    } catch {
        return false;
    }
}

function decodeBase64Url(value: string): Buffer | null {
    try {
        return Buffer.from(value, 'base64url');
    } catch {
        return null;
    }
}

export function buildChallengeMessage(txId: string, challengeId: string): Buffer {
    return Buffer.from(`${txId}:${challengeId}`, 'utf8');
}

export function hashChallengeNonce(challengeNonce: string): string {
    return crypto.createHash('sha256').update(challengeNonce).digest('hex');
}

export function verifyEd25519Signature(
    devicePubkeyBase64Url: string,
    signatureBase64Url: string,
    message: Buffer,
): boolean {
    const publicKeyBytes = decodeBase64Url(devicePubkeyBase64Url);
    const signatureBytes = decodeBase64Url(signatureBase64Url);

    if (!publicKeyBytes || !signatureBytes || publicKeyBytes.length !== 32) {
        return false;
    }

    try {
        const keyObject = crypto.createPublicKey({
            key: Buffer.concat([
                Buffer.from('302a300506032b6570032100', 'hex'),
                publicKeyBytes,
            ]),
            format: 'der',
            type: 'spki',
        });

        return crypto.verify(null, message, keyObject, signatureBytes);
    } catch {
        return false;
    }
}

export function parseAmountToBigInt(rawAmount: unknown): bigint | null {
    if (typeof rawAmount !== 'string' || !/^[0-9]+$/.test(rawAmount)) {
        return null;
    }

    try {
        const amount = BigInt(rawAmount);
        return amount > 0n ? amount : null;
    } catch {
        return null;
    }
}

export function isValidPin(pin: unknown): pin is string {
    return typeof pin === 'string' && /^[0-9]{4,12}$/.test(pin.trim());
}
