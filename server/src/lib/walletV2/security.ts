import argon2 from 'argon2';
import * as bip39 from 'bip39';
import crypto from 'crypto';

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MNEMONIC_WORD_COUNT = 24;
const SALT_BYTES = 16;
const REFRESH_TOKEN_BYTES = 48;
const CHALLENGE_NONCE_BYTES = 32;
const WALLET_V2_MAINNET_PREFIX = 'LV';
const WALLET_V2_TESTNET_PREFIX = 'tLV';
export const WALLET_V2_ADDRESS_BODY_LENGTH = 30;
const WALLET_V2_ADDRESS_BODY_REGEX = new RegExp(`^[0-9A-HJKMNP-TV-Z]{${WALLET_V2_ADDRESS_BODY_LENGTH}}$`);

const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
};

export type WalletV2Network = 'mainnet' | 'testnet';

export const WALLET_V2_ADDRESS_REGEX = new RegExp(`^(LV|tLV)-([0-9A-HJKMNP-TV-Z]{${WALLET_V2_ADDRESS_BODY_LENGTH}})$`, 'i');

function resolveWalletV2Network(): WalletV2Network {
    const configured = process.env.WALLET_V2_NETWORK?.trim().toLowerCase();

    if (configured === 'mainnet' || configured === 'testnet') {
        return configured;
    }

    if (process.env.NODE_ENV === 'production') {
        return 'mainnet';
    }

    return 'testnet';
}

const walletV2Network = resolveWalletV2Network();

function resolveAddressPrefix(network: WalletV2Network): string {
    return network === 'testnet' ? WALLET_V2_TESTNET_PREFIX : WALLET_V2_MAINNET_PREFIX;
}

function parseWalletV2AddressBody(rawValue: string): string | null {
    const normalized = rawValue.trim().replace(/\s+/g, '');
    const match = normalized.match(WALLET_V2_ADDRESS_REGEX);

    if (!match) {
        return null;
    }

    const body = (match[2] || '').toUpperCase();
    return WALLET_V2_ADDRESS_BODY_REGEX.test(body) ? body : null;
}

export function getWalletV2Network(): WalletV2Network {
    return walletV2Network;
}

export function getWalletV2AddressPrefix(network: WalletV2Network = walletV2Network): string {
    return resolveAddressPrefix(network);
}

export function getWalletV2AddressRegex(network: WalletV2Network = walletV2Network): RegExp {
    if (network === 'testnet') {
        return new RegExp(`^tLV-[0-9A-HJKMNP-TV-Z]{${WALLET_V2_ADDRESS_BODY_LENGTH}}$`);
    }

    return new RegExp(`^LV-[0-9A-HJKMNP-TV-Z]{${WALLET_V2_ADDRESS_BODY_LENGTH}}$`);
}

export function normalizeWalletV2Address(value: string, network: WalletV2Network = walletV2Network): string | null {
    const body = parseWalletV2AddressBody(value);

    if (!body) {
        return null;
    }

    return `${resolveAddressPrefix(network)}-${body}`;
}

export function formatWalletV2AddressForNetwork(value: string, network: WalletV2Network = walletV2Network): string {
    return normalizeWalletV2Address(value, network) || value;
}

export function buildWalletV2AddressCandidates(value: string, network: WalletV2Network = walletV2Network): string[] {
    const body = parseWalletV2AddressBody(value);

    if (!body) {
        return [];
    }

    const primaryPrefix = resolveAddressPrefix(network);
    const fallbackPrefix = primaryPrefix === WALLET_V2_TESTNET_PREFIX
        ? WALLET_V2_MAINNET_PREFIX
        : WALLET_V2_TESTNET_PREFIX;

    return [`${primaryPrefix}-${body}`, `${fallbackPrefix}-${body}`];
}

export function buildWalletV2AddressFromBody(body: string, network: WalletV2Network = walletV2Network): string | null {
    const normalizedBody = body.trim().toUpperCase();

    if (!WALLET_V2_ADDRESS_BODY_REGEX.test(normalizedBody)) {
        return null;
    }

    return `${resolveAddressPrefix(network)}-${normalizedBody}`;
}

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
    return `${resolveAddressPrefix(walletV2Network)}-${randomCrockfordBody(WALLET_V2_ADDRESS_BODY_LENGTH)}`;
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

export function buildChallengeMessage(txId: string, challengeId: string, challengeNonce: string): Buffer {
    return Buffer.from(`${txId}:${challengeId}:${challengeNonce}`, 'utf8');
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
    return typeof pin === 'string' && /^[0-9]{4}$/.test(pin.trim());
}
