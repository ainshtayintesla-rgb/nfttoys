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

function isBrowser(): boolean {
    return typeof window !== 'undefined';
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

export function getAuthToken(): string | null {
    if (tokenCache) return tokenCache;
    if (!isBrowser()) return null;

    tokenCache = localStorage.getItem(AUTH_TOKEN_KEY);
    return tokenCache;
}

export function setAuthToken(token: string | null) {
    tokenCache = token;
    if (!isBrowser()) return;

    if (token) {
        localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
        localStorage.removeItem(AUTH_TOKEN_KEY);
    }
}

export function getAuthUser(): AuthUser | null {
    if (userCache) return userCache;
    if (!isBrowser()) return null;

    const raw = localStorage.getItem(AUTH_USER_KEY);
    if (!raw) return null;

    try {
        userCache = JSON.parse(raw) as AuthUser;
        return userCache;
    } catch {
        localStorage.removeItem(AUTH_USER_KEY);
        return null;
    }
}

export function setAuthUser(user: AuthUser | null) {
    userCache = user;
    if (!isBrowser()) return;

    if (user) {
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    } else {
        localStorage.removeItem(AUTH_USER_KEY);
    }
}

export function clearAuthSession() {
    setAuthToken(null);
    setAuthUser(null);
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

export function getTelegramInitData(): string | null {
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

export async function refreshAuthSession(): Promise<TelegramAuthResponse | null> {
    if (!isBrowser()) {
        return null;
    }

    if (authRefreshInFlight) {
        return authRefreshInFlight;
    }

    const initData = getTelegramInitData();
    if (!initData) {
        return null;
    }

    authRefreshInFlight = (async () => {
        let response: Response;

        try {
            response = await fetch(`${API_BASE_URL}/auth/telegram`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Telegram-Init-Data': initData,
                },
                body: JSON.stringify({ initData }),
                credentials: 'include',
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
