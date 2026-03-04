export interface WalletV2SessionTokens {
    accessToken: string;
    refreshToken: string;
    expiresInSec: number;
}

export interface WalletV2SessionState {
    walletId: string | null;
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: number;
}

const WALLET_V2_SESSION_KEY = 'nfttoys_wallet_v2_session';
const WALLET_V2_DEVICE_ID_KEY = 'nfttoys_wallet_v2_device_id';

let sessionCache: WalletV2SessionState | null = null;
let deviceIdCache: string | null = null;

function isBrowser(): boolean {
    return typeof window !== 'undefined';
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    return value as Record<string, unknown>;
}

function normalizeOptionalString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    return normalized ? normalized : null;
}

function parseStoredSession(rawValue: string | null): WalletV2SessionState | null {
    if (!rawValue) {
        return null;
    }

    try {
        const parsed = JSON.parse(rawValue);
        const record = asRecord(parsed);
        const accessToken = normalizeOptionalString(record?.accessToken);
        const refreshToken = normalizeOptionalString(record?.refreshToken);
        const walletId = normalizeOptionalString(record?.walletId);
        const accessTokenExpiresAtRaw = record?.accessTokenExpiresAt;
        const accessTokenExpiresAt = typeof accessTokenExpiresAtRaw === 'number'
            && Number.isFinite(accessTokenExpiresAtRaw)
            ? accessTokenExpiresAtRaw
            : null;

        if (!accessToken || !refreshToken || !accessTokenExpiresAt) {
            return null;
        }

        return {
            walletId,
            accessToken,
            refreshToken,
            accessTokenExpiresAt,
        };
    } catch {
        return null;
    }
}

function writeSessionToStorage(session: WalletV2SessionState | null): void {
    if (!isBrowser()) {
        return;
    }

    if (session) {
        localStorage.setItem(WALLET_V2_SESSION_KEY, JSON.stringify(session));
    } else {
        localStorage.removeItem(WALLET_V2_SESSION_KEY);
    }
}

function writeDeviceIdToStorage(deviceId: string | null): void {
    if (!isBrowser()) {
        return;
    }

    if (deviceId) {
        localStorage.setItem(WALLET_V2_DEVICE_ID_KEY, deviceId);
    } else {
        localStorage.removeItem(WALLET_V2_DEVICE_ID_KEY);
    }
}

export function getWalletV2Session(): WalletV2SessionState | null {
    if (sessionCache) {
        return sessionCache;
    }

    if (!isBrowser()) {
        return null;
    }

    const restored = parseStoredSession(localStorage.getItem(WALLET_V2_SESSION_KEY));

    if (!restored) {
        localStorage.removeItem(WALLET_V2_SESSION_KEY);
    }

    sessionCache = restored;
    return sessionCache;
}

export function setWalletV2Session(session: WalletV2SessionState | null): void {
    sessionCache = session;
    writeSessionToStorage(session);
}

export function persistWalletV2Session(params: {
    walletId?: string | null;
    session: WalletV2SessionTokens;
}): WalletV2SessionState {
    const current = getWalletV2Session();
    const walletId = normalizeOptionalString(params.walletId) ?? current?.walletId ?? null;
    const safeExpiresInSec = Number.isFinite(params.session.expiresInSec)
        ? Math.max(0, Math.floor(params.session.expiresInSec))
        : 0;
    const nextSession: WalletV2SessionState = {
        walletId,
        accessToken: params.session.accessToken,
        refreshToken: params.session.refreshToken,
        accessTokenExpiresAt: Date.now() + safeExpiresInSec * 1000,
    };

    setWalletV2Session(nextSession);

    return nextSession;
}

export function setWalletV2WalletId(walletId: string | null): void {
    const current = getWalletV2Session();

    if (!current) {
        return;
    }

    setWalletV2Session({
        ...current,
        walletId: normalizeOptionalString(walletId),
    });
}

export function getWalletV2WalletId(): string | null {
    return getWalletV2Session()?.walletId || null;
}

export function getWalletV2AccessToken(): string | null {
    return getWalletV2Session()?.accessToken || null;
}

export function getWalletV2RefreshToken(): string | null {
    return getWalletV2Session()?.refreshToken || null;
}

export function clearWalletV2Session(): void {
    setWalletV2Session(null);
}

export function getWalletV2DeviceId(): string | null {
    if (deviceIdCache) {
        return deviceIdCache;
    }

    if (!isBrowser()) {
        return null;
    }

    const restored = normalizeOptionalString(localStorage.getItem(WALLET_V2_DEVICE_ID_KEY));

    if (!restored) {
        localStorage.removeItem(WALLET_V2_DEVICE_ID_KEY);
    }

    deviceIdCache = restored;
    return deviceIdCache;
}

export function setWalletV2DeviceId(deviceId: string | null): void {
    const normalized = normalizeOptionalString(deviceId);
    deviceIdCache = normalized;
    writeDeviceIdToStorage(normalized);
}

