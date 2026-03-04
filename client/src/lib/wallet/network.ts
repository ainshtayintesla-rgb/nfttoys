export type WalletNetwork = 'mainnet' | 'testnet';

export const WALLET_FRIENDLY_BODY_LENGTH = 30;
const FRIENDLY_BODY_PATTERN = `[A-Z0-9_]{${WALLET_FRIENDLY_BODY_LENGTH}}`;
const FRIENDLY_BODY_REGEX = new RegExp(`^${FRIENDLY_BODY_PATTERN}$`);
const FRIENDLY_ANY_REGEX = new RegExp(`^(LV|tLV)-(?!_)(?!.*_.*_)(${FRIENDLY_BODY_PATTERN})$`, 'i');

function resolveWalletNetwork(): WalletNetwork {
    const configured = process.env.NEXT_PUBLIC_WALLET_NETWORK?.trim().toLowerCase();

    if (configured === 'mainnet' || configured === 'testnet') {
        return configured;
    }

    if (process.env.NODE_ENV === 'production') {
        return 'mainnet';
    }

    return 'testnet';
}

function stripFriendlyPrefix(value: string): string {
    return value.trim().replace(/^(?:tLV|LV|UZ)-?/i, '');
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

export const WALLET_NETWORK = resolveWalletNetwork();
export const WALLET_IS_TESTNET = WALLET_NETWORK === 'testnet';
export const WALLET_FRIENDLY_PREFIX_SHORT = WALLET_IS_TESTNET ? 'tLV' : 'LV';
export const WALLET_FRIENDLY_PREFIX = `${WALLET_FRIENDLY_PREFIX_SHORT}-`;
export const WALLET_FRIENDLY_PLACEHOLDER = `${WALLET_FRIENDLY_PREFIX}${'X'.repeat(WALLET_FRIENDLY_BODY_LENGTH)}`;

export function sanitizeWalletFriendlyBody(value: string): string {
    const upper = stripFriendlyPrefix(value)
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '');

    let normalized = upper;
    while (normalized.startsWith('_')) {
        normalized = normalized.slice(1);
    }

    let seenUnderscore = false;
    let result = '';

    for (const char of normalized) {
        if (char === '_') {
            if (seenUnderscore) {
                continue;
            }
            seenUnderscore = true;
        }

        result += char;
        if (result.length >= WALLET_FRIENDLY_BODY_LENGTH) {
            break;
        }
    }

    return result;
}

export function buildWalletFriendlyAddress(bodyOrAddress: string): string {
    const body = sanitizeWalletFriendlyBody(bodyOrAddress);

    if (!body) {
        return '';
    }

    return `${WALLET_FRIENDLY_PREFIX}${body}`;
}

export function normalizeWalletFriendlyAddress(value: string): string | null {
    const body = parseFriendlyBody(value);

    if (!body) {
        return null;
    }

    return `${WALLET_FRIENDLY_PREFIX}${body}`;
}

export function formatWalletFriendlyAddressForNetwork(value: string): string {
    const normalized = normalizeWalletFriendlyAddress(value);

    if (normalized) {
        return normalized;
    }

    return value.trim();
}

export function formatWalletShortLabel(value: string | null): string {
    if (!value) {
        return '—';
    }

    const normalized = value.trim();
    if (!normalized) {
        return '—';
    }

    const normalizedFriendly = normalizeWalletFriendlyAddress(normalized);
    if (normalizedFriendly) {
        const body = normalizedFriendly.slice(WALLET_FRIENDLY_PREFIX.length);
        return `${WALLET_FRIENDLY_PREFIX_SHORT}-...${body.slice(-6)}`;
    }

    const tail = normalized.toUpperCase().slice(-6);
    if (!tail) {
        return '—';
    }

    return `${WALLET_FRIENDLY_PREFIX_SHORT}-...${tail}`;
}
