import { API_BASE_URL } from './apiBaseUrl';
import { getTelegramWebApp } from './utils/telegram';

export interface AuthUser {
    uid: string;
    telegramId: number;
    firstName?: string;
    lastName?: string;
    username?: string;
}

export interface TelegramAuthResponseUser {
    uid: string;
    telegramId: number | string;
    firstName?: string;
    lastName?: string;
    username?: string;
    photoUrl?: string;
    walletAddress?: string;
    walletFriendly?: string;
}

export interface TelegramAuthResponse {
    token: string;
    user: TelegramAuthResponseUser;
    tokenType?: string;
    expiresIn?: number | string;
}

const AUTH_TOKEN_KEY = 'nfttoys_auth_token';
const AUTH_USER_KEY = 'nfttoys_auth_user';

let tokenCache: string | null = null;
let userCache: AuthUser | null = null;
let authRefreshInFlight: Promise<TelegramAuthResponse | null> | null = null;
let telegramInitDataCache: string | null = null;
let legacyStorageCleared = false;

function isBrowser(): boolean {
    return typeof window !== 'undefined';
}

function trimValue(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    return normalized || null;
}

function clearLegacyStorage() {
    if (!isBrowser() || legacyStorageCleared) {
        return;
    }

    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    legacyStorageCleared = true;
}

function normalizeTelegramId(value: number | string): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function isValidTelegramAuthResponse(payload: unknown): payload is TelegramAuthResponse {
    if (!payload || typeof payload !== 'object') {
        return false;
    }

    const authPayload = payload as Partial<TelegramAuthResponse>;
    return typeof authPayload.token === 'string'
        && !!authPayload.token
        && !!authPayload.user
        && typeof authPayload.user.uid === 'string'
        && authPayload.user.uid.length > 0
        && (
            typeof authPayload.user.telegramId === 'number'
            || typeof authPayload.user.telegramId === 'string'
        );
}

export function bootstrapAuthState() {
    tokenCache = null;
    userCache = null;
    clearLegacyStorage();
}

export function getAuthToken(): string | null {
    return tokenCache;
}

export function setAuthToken(token: string | null) {
    tokenCache = trimValue(token);

    if (!tokenCache) {
        clearLegacyStorage();
    }
}

export function getAuthUser(): AuthUser | null {
    return userCache;
}

export function setAuthUser(user: AuthUser | null) {
    userCache = user;

    if (!user) {
        clearLegacyStorage();
    }
}

export function clearAuthSession() {
    tokenCache = null;
    userCache = null;
    clearLegacyStorage();
}

export function toAuthUser(user: TelegramAuthResponseUser): AuthUser {
    return {
        uid: user.uid,
        telegramId: normalizeTelegramId(user.telegramId),
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
    };
}

export function persistTelegramAuthResponse(payload: TelegramAuthResponse): AuthUser {
    if (!isValidTelegramAuthResponse(payload)) {
        throw new Error('Invalid auth response');
    }

    const authUser = toAuthUser(payload.user);
    setAuthToken(payload.token);
    setAuthUser(authUser);
    return authUser;
}

export function setTelegramInitData(initData: string | null | undefined) {
    telegramInitDataCache = trimValue(initData);
}

export function getTelegramInitData(): string | null {
    if (telegramInitDataCache) {
        return telegramInitDataCache;
    }

    if (!isBrowser()) {
        return null;
    }

    const initData = getTelegramWebApp()?.initData?.trim();
    return initData || null;
}

export function attachTelegramInitData(headers: Headers): boolean {
    if (headers.has('X-Telegram-Init-Data')) {
        return true;
    }

    const initData = getTelegramInitData();
    if (!initData) {
        return false;
    }

    headers.set('X-Telegram-Init-Data', initData);
    return true;
}

export async function refreshAuthSession(initDataOverride?: string | null): Promise<TelegramAuthResponse | null> {
    if (!isBrowser()) {
        return null;
    }

    if (authRefreshInFlight) {
        return authRefreshInFlight;
    }

    const initData = trimValue(initDataOverride) || getTelegramInitData();
    if (!initData) {
        return null;
    }

    setTelegramInitData(initData);

    authRefreshInFlight = (async () => {
        let response: Response;

        try {
            response = await fetch(`${API_BASE_URL}/auth/telegram`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-Telegram-Init-Data': initData,
                },
                body: JSON.stringify({ initData }),
                credentials: 'include',
                cache: 'no-store',
            });
        } catch {
            return null;
        }

        const payload = await response.json().catch(() => null);

        if (!response.ok || !isValidTelegramAuthResponse(payload)) {
            if (response.status === 400 || response.status === 401) {
                clearAuthSession();
            }
            return null;
        }

        persistTelegramAuthResponse(payload);
        return payload;
    })();

    try {
        return await authRefreshInFlight;
    } finally {
        authRefreshInFlight = null;
    }
}
