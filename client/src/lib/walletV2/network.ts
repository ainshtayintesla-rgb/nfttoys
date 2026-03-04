export type WalletV2Network = 'mainnet' | 'testnet';

export const WALLET_V2_ADDRESS_BODY_LENGTH = 30;
const ADDRESS_BODY_PATTERN = `[0-9A-HJKMNP-TV-Z]{${WALLET_V2_ADDRESS_BODY_LENGTH}}`;
const ADDRESS_BODY_REGEX = new RegExp(`^${ADDRESS_BODY_PATTERN}$`);
const ANY_ADDRESS_REGEX = new RegExp(`^(LV|tLV)-(${ADDRESS_BODY_PATTERN})$`, 'i');

function resolveWalletV2Network(): WalletV2Network {
    const configured = process.env.NEXT_PUBLIC_WALLET_V2_NETWORK?.trim().toLowerCase();

    if (configured === 'mainnet' || configured === 'testnet') {
        return configured;
    }

    if (process.env.NODE_ENV === 'production') {
        return 'mainnet';
    }

    return 'testnet';
}

function parseWalletV2AddressBody(value: string): string | null {
    const normalized = value.trim().replace(/\s+/g, '');
    const match = normalized.match(ANY_ADDRESS_REGEX);

    if (!match) {
        return null;
    }

    const body = (match[2] || '').toUpperCase();
    return ADDRESS_BODY_REGEX.test(body) ? body : null;
}

export const WALLET_V2_NETWORK = resolveWalletV2Network();
export const WALLET_V2_IS_TESTNET = WALLET_V2_NETWORK === 'testnet';
export const WALLET_V2_ADDRESS_PREFIX = WALLET_V2_IS_TESTNET ? 'tLV' : 'LV';
export const WALLET_V2_ADDRESS_REGEX = WALLET_V2_IS_TESTNET
    ? new RegExp(`^tLV-${ADDRESS_BODY_PATTERN}$`)
    : new RegExp(`^LV-${ADDRESS_BODY_PATTERN}$`);
export const WALLET_V2_ADDRESS_PLACEHOLDER = `${WALLET_V2_ADDRESS_PREFIX}-${'X'.repeat(WALLET_V2_ADDRESS_BODY_LENGTH)}`;

export function normalizeWalletV2Address(value: string): string | null {
    const body = parseWalletV2AddressBody(value);

    if (!body) {
        return null;
    }

    return `${WALLET_V2_ADDRESS_PREFIX}-${body}`;
}

export function formatWalletV2Address(value: string): string {
    return normalizeWalletV2Address(value) || value;
}

export function sanitizeWalletV2AddressInput(value: string): string {
    const compact = value
        .replace(/\s+/g, '')
        .replace(/[^a-zA-Z0-9-]/g, '')
        .replace(/^t?lv-?/i, '');
    const body = compact
        .toUpperCase()
        .replace(/[^0-9A-HJKMNP-TV-Z]/g, '')
        .slice(0, WALLET_V2_ADDRESS_BODY_LENGTH);

    if (!body) {
        return '';
    }

    return `${WALLET_V2_ADDRESS_PREFIX}-${body}`;
}
