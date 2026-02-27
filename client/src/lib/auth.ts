export interface AuthUser {
    uid: string;
    telegramId: number;
    firstName?: string;
    lastName?: string;
    username?: string;
}

const AUTH_TOKEN_KEY = 'nfttoys_auth_token';
const AUTH_USER_KEY = 'nfttoys_auth_user';

let tokenCache: string | null = null;
let userCache: AuthUser | null = null;

function isBrowser(): boolean {
    return typeof window !== 'undefined';
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

