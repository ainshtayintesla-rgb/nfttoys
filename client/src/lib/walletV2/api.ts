import { getAuthToken } from '../auth';
import { WalletV2ApiError, normalizeWalletV2Error } from './errors';
import {
    clearWalletV2Session,
    getWalletV2AccessToken,
    getWalletV2DeviceId,
    getWalletV2RefreshToken,
    getWalletV2Session,
    getWalletV2WalletId,
    persistWalletV2Session,
    setWalletV2DeviceId,
    setWalletV2WalletId,
    WalletV2SessionTokens,
} from './tokenStore';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const WALLET_V2_API_PREFIX = '/v2';

const SESSION_REFRESH_RETRY_STATUS = 401;
const SESSION_REFRESH_RETRY_CODE = 'UNAUTHORIZED';

type WalletV2ApiEnvelope<T> = {
    success: boolean;
    data: T;
};

type WalletV2RequestOptions = RequestInit & {
    requiresWalletSession?: boolean;
};

export type WalletV2DevicePlatform = 'ios' | 'android' | 'web';

export interface WalletV2DeviceInput {
    deviceId: string;
    platform: WalletV2DevicePlatform;
    biometricSupported: boolean;
    devicePubKey?: string | null;
}

export interface WalletV2Wallet {
    id: string;
    address: string;
    status: string;
    createdAt?: string;
}

export type WalletV2SessionInfo = WalletV2SessionTokens;

export interface WalletV2SessionRow {
    id: string;
    deviceId: string;
    platform: WalletV2DevicePlatform;
    biometricSupported: boolean;
    status: string;
    createdAt: string;
    lastSeenAt: string;
    isCurrent: boolean;
}

export interface WalletV2BalanceRow {
    asset: string;
    available: string;
    locked: string;
    updatedAt: string;
}

export interface WalletV2BalanceData {
    walletId: string;
    address: string;
    balances: WalletV2BalanceRow[];
}

export interface WalletV2TransactionRow {
    id: string;
    type: 'send' | 'receive' | 'topup' | string;
    direction: 'in' | 'out';
    fromAddress: string;
    toAddress: string;
    asset: string;
    amount: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
}

export interface WalletV2TransactionsData {
    walletId: string;
    address: string;
    items: WalletV2TransactionRow[];
}

export interface WalletV2TestnetTopupData {
    walletId: string;
    network: 'mainnet' | 'testnet';
    balance: WalletV2BalanceRow;
    tx: {
        id: string;
        status: string;
        fromAddress: string;
        toAddress: string;
        asset: string;
        amount: string;
        createdAt: string;
        completedAt: string | null;
    };
}

export interface WalletV2CreatePayload {
    pin?: string;
    device: WalletV2DeviceInput;
}

export interface WalletV2CreateData {
    wallet: WalletV2Wallet;
    mnemonic: string[];
    session: WalletV2SessionInfo;
}

export interface WalletV2ImportPayload {
    mnemonic: string[];
    newPin: string;
    device: WalletV2DeviceInput;
}

export interface WalletV2ImportData {
    wallet: WalletV2Wallet;
    session: WalletV2SessionInfo;
}

export interface WalletV2VerifyPinData {
    valid: boolean;
}

export interface WalletV2ChangePinPayload {
    walletId?: string;
    newPin: string;
}

export interface WalletV2ChangePinData {
    walletId: string;
    pinUpdatedAt: string;
}

export interface WalletV2TxCreatePayload {
    walletId?: string;
    toAddress: string;
    asset: string;
    amount: string;
    idempotencyKey: string;
    meta?: Record<string, unknown>;
}

export interface WalletV2TxCreateData {
    tx: {
        id: string;
        status: string;
        fromAddress: string;
        toAddress: string;
        asset: string;
        amount: string;
        createdAt: string;
    };
    challenge: {
        challengeId: string;
        expiresAt: string;
        methods: string[];
    };
}

export interface WalletV2TxConfirmPayload {
    txId: string;
    challengeId: string;
    auth: {
        method: 'pin';
        pin: string;
    } | {
        method: 'biometric';
        deviceId: string;
        signature: string;
    };
}

export interface WalletV2TxConfirmData {
    tx: {
        id: string;
        status: string;
        completedAt: string | null;
    };
}

type SessionRevokedListener = (error: WalletV2ApiError) => void;

let refreshInFlight: Promise<WalletV2SessionInfo> | null = null;
const sessionRevokedListeners = new Set<SessionRevokedListener>();

function normalizePath(path: string): string {
    return path.startsWith('/') ? path : `/${path}`;
}

function buildWalletV2Url(path: string): string {
    return `${API_BASE_URL}${WALLET_V2_API_PREFIX}${normalizePath(path)}`;
}

function isSessionRevokedCode(code: string): boolean {
    return code === 'SESSION_REVOKED'
        || code === 'INVALID_REFRESH_TOKEN'
        || code === 'DEVICE_MISMATCH'
        || code === 'WALLET_SESSION_MISSING';
}

function shouldRetryViaRefresh(error: WalletV2ApiError): boolean {
    return error.status === SESSION_REFRESH_RETRY_STATUS || error.code === SESSION_REFRESH_RETRY_CODE;
}

function requireLegacyAuthToken(): string {
    const token = getAuthToken();

    if (!token) {
        throw new WalletV2ApiError('Login required', {
            status: 401,
            code: 'UNAUTHORIZED',
        });
    }

    return token;
}

function resolveWalletId(walletId?: string): string {
    const normalized = walletId?.trim();
    const stored = getWalletV2WalletId();
    const resolved = normalized || stored;

    if (!resolved) {
        throw new WalletV2ApiError('Wallet id is required', {
            status: 400,
            code: 'WALLET_ID_REQUIRED',
        });
    }

    return resolved;
}

function notifySessionRevoked(error: WalletV2ApiError): void {
    clearWalletV2Session();

    sessionRevokedListeners.forEach((listener) => {
        try {
            listener(error);
        } catch {
            // Listener errors should not break API flow.
        }
    });
}

async function parseJsonSafe(response: Response): Promise<unknown> {
    const text = await response.text();

    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

async function requestWalletV2<T>(path: string, options: WalletV2RequestOptions = {}): Promise<T> {
    const { requiresWalletSession = true, ...requestInit } = options;
    const url = buildWalletV2Url(path);
    const headers = new Headers(requestInit.headers || {});

    if (requestInit.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    if (requiresWalletSession && !headers.has('Authorization')) {
        const accessToken = getWalletV2AccessToken();

        if (accessToken) {
            headers.set('Authorization', `Bearer ${accessToken}`);
        }
    }

    const response = await fetch(url, {
        ...requestInit,
        headers,
        credentials: 'include',
    });

    const payload = await parseJsonSafe(response);

    if (!response.ok) {
        throw normalizeWalletV2Error({
            status: response.status,
            payload,
            fallbackCode: 'HTTP_ERROR',
            fallbackMessage: `HTTP ${response.status}`,
        });
    }

    return payload as T;
}

async function refreshWalletV2SessionInternal(): Promise<WalletV2SessionInfo> {
    if (refreshInFlight) {
        return refreshInFlight;
    }

    refreshInFlight = (async () => {
        const refreshToken = getWalletV2RefreshToken();
        const deviceId = getWalletV2DeviceId();

        if (!refreshToken || !deviceId) {
            const missingSessionError = new WalletV2ApiError('Wallet session is missing', {
                status: 401,
                code: 'WALLET_SESSION_MISSING',
            });
            notifySessionRevoked(missingSessionError);
            throw missingSessionError;
        }

        try {
            const response = await requestWalletV2<WalletV2ApiEnvelope<{ session: WalletV2SessionInfo }>>(
                '/session/refresh',
                {
                    method: 'POST',
                    requiresWalletSession: false,
                    body: JSON.stringify({
                        refreshToken,
                        deviceId,
                    }),
                },
            );

            const nextSession = response?.data?.session;

            if (!nextSession?.accessToken || !nextSession?.refreshToken) {
                throw new WalletV2ApiError('Session refresh payload is invalid', {
                    status: 500,
                    code: 'INVALID_RESPONSE',
                });
            }

            persistWalletV2Session({ session: nextSession });

            return nextSession;
        } catch (refreshError) {
            const normalized = normalizeWalletV2Error({
                payload: refreshError,
                fallbackCode: 'REFRESH_FAILED',
                fallbackMessage: 'Failed to refresh wallet session',
            });

            if (isSessionRevokedCode(normalized.code)) {
                notifySessionRevoked(normalized);
            }

            throw normalized;
        }
    })();

    try {
        return await refreshInFlight;
    } finally {
        refreshInFlight = null;
    }
}

async function walletV2Fetch<T>(path: string, options: WalletV2RequestOptions = {}): Promise<T> {
    const { requiresWalletSession = true, ...requestInit } = options;

    try {
        return await requestWalletV2<T>(path, {
            ...requestInit,
            requiresWalletSession,
        });
    } catch (requestError) {
        const normalized = normalizeWalletV2Error({
            payload: requestError,
            fallbackCode: 'REQUEST_FAILED',
            fallbackMessage: 'Wallet request failed',
        });

        if (!requiresWalletSession) {
            throw normalized;
        }

        if (shouldRetryViaRefresh(normalized)) {
            await refreshWalletV2SessionInternal();

            try {
                return await requestWalletV2<T>(path, {
                    ...requestInit,
                    requiresWalletSession: true,
                });
            } catch (retryError) {
                const retryNormalized = normalizeWalletV2Error({
                    payload: retryError,
                    fallbackCode: 'REQUEST_FAILED',
                    fallbackMessage: 'Wallet request failed',
                });

                if (isSessionRevokedCode(retryNormalized.code)) {
                    notifySessionRevoked(retryNormalized);
                }

                throw retryNormalized;
            }
        }

        if (isSessionRevokedCode(normalized.code)) {
            notifySessionRevoked(normalized);
        }

        throw normalized;
    }
}

export function onWalletV2SessionRevoked(listener: SessionRevokedListener): () => void {
    sessionRevokedListeners.add(listener);

    return () => {
        sessionRevokedListeners.delete(listener);
    };
}

export const walletV2Api = {
    async create(payload: WalletV2CreatePayload): Promise<WalletV2CreateData> {
        const legacyToken = requireLegacyAuthToken();
        const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2CreateData>>('/wallet/create', {
            method: 'POST',
            requiresWalletSession: false,
            headers: {
                Authorization: `Bearer ${legacyToken}`,
            },
            body: JSON.stringify(payload),
        });

        setWalletV2DeviceId(payload.device.deviceId);
        persistWalletV2Session({
            walletId: response.data.wallet.id,
            session: response.data.session,
        });

        return response.data;
    },

    async import(payload: WalletV2ImportPayload): Promise<WalletV2ImportData> {
        const legacyToken = requireLegacyAuthToken();
        const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2ImportData>>('/wallet/import', {
            method: 'POST',
            requiresWalletSession: false,
            headers: {
                Authorization: `Bearer ${legacyToken}`,
            },
            body: JSON.stringify(payload),
        });

        setWalletV2DeviceId(payload.device.deviceId);
        persistWalletV2Session({
            walletId: response.data.wallet.id,
            session: response.data.session,
        });

        return response.data;
    },

    async refreshSession(): Promise<WalletV2SessionInfo> {
        return refreshWalletV2SessionInternal();
    },

    async logout(): Promise<{ revoked: boolean }> {
        const refreshToken = getWalletV2RefreshToken();

        if (!refreshToken) {
            throw new WalletV2ApiError('Wallet session is missing', {
                status: 401,
                code: 'WALLET_SESSION_MISSING',
            });
        }

        const response = await walletV2Fetch<WalletV2ApiEnvelope<{ revoked: boolean }>>('/session/logout', {
            method: 'POST',
            body: JSON.stringify({ refreshToken }),
        });

        clearWalletV2Session();

        return response.data;
    },

    async sessions(): Promise<WalletV2SessionRow[]> {
        const response = await walletV2Fetch<WalletV2ApiEnvelope<{ sessions: WalletV2SessionRow[] }>>('/sessions');
        return response.data.sessions || [];
    },

    async revokeSession(sessionId: string): Promise<{ revoked: boolean }> {
        const response = await walletV2Fetch<WalletV2ApiEnvelope<{ revoked: boolean }>>('/sessions/revoke', {
            method: 'POST',
            body: JSON.stringify({ sessionId }),
        });

        return response.data;
    },

    async balance(walletId?: string): Promise<WalletV2BalanceData> {
        const resolvedWalletId = resolveWalletId(walletId);
        const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2BalanceData>>(
            `/wallet/${encodeURIComponent(resolvedWalletId)}/balance`,
        );

        setWalletV2WalletId(response.data.walletId);

        return response.data;
    },

    async transactions(walletId?: string, params: { limit?: number } = {}): Promise<WalletV2TransactionsData> {
        const resolvedWalletId = resolveWalletId(walletId);
        const query = new URLSearchParams();

        if (typeof params.limit === 'number' && Number.isFinite(params.limit)) {
            query.set('limit', String(Math.max(1, Math.floor(params.limit))));
        }

        const queryString = query.toString();
        const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2TransactionsData>>(
            `/wallet/${encodeURIComponent(resolvedWalletId)}/transactions${queryString ? `?${queryString}` : ''}`,
        );

        setWalletV2WalletId(response.data.walletId);

        return response.data;
    },

    async receive(walletId?: string): Promise<{ walletId: string; address: string }> {
        const data = await walletV2Api.balance(walletId);
        return {
            walletId: data.walletId,
            address: data.address,
        };
    },

    async testnetTopup(payload: { walletId?: string; amount: string; asset?: string }): Promise<WalletV2TestnetTopupData> {
        const walletId = resolveWalletId(payload.walletId);
        const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2TestnetTopupData>>(
            `/wallet/${encodeURIComponent(walletId)}/topup-testnet`,
            {
                method: 'POST',
                body: JSON.stringify({
                    amount: payload.amount,
                    ...(payload.asset ? { asset: payload.asset } : {}),
                }),
            },
        );

        return response.data;
    },

    async verifyPin(payload: { walletId?: string; pin: string }): Promise<WalletV2VerifyPinData> {
        const walletId = resolveWalletId(payload.walletId);
        const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2VerifyPinData>>(
            `/wallet/${encodeURIComponent(walletId)}/pin/verify`,
            {
                method: 'POST',
                body: JSON.stringify({
                    pin: payload.pin,
                }),
            },
        );

        return response.data;
    },

    async changePin(payload: WalletV2ChangePinPayload): Promise<WalletV2ChangePinData> {
        const walletId = resolveWalletId(payload.walletId);
        const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2ChangePinData>>(
            `/wallet/${encodeURIComponent(walletId)}/pin/change`,
            {
                method: 'POST',
                body: JSON.stringify({
                    newPin: payload.newPin,
                }),
            },
        );

        return response.data;
    },

    async sendCreate(payload: WalletV2TxCreatePayload): Promise<WalletV2TxCreateData> {
        const walletId = resolveWalletId(payload.walletId);
        const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2TxCreateData>>('/tx/create', {
            method: 'POST',
            body: JSON.stringify({
                ...payload,
                walletId,
            }),
        });

        return response.data;
    },

    async sendConfirm(payload: WalletV2TxConfirmPayload): Promise<WalletV2TxConfirmData> {
        const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2TxConfirmData>>('/tx/confirm', {
            method: 'POST',
            body: JSON.stringify(payload),
        });

        return response.data;
    },

    session: {
        get: getWalletV2Session,
        clear: clearWalletV2Session,
        getDeviceId: getWalletV2DeviceId,
        setDeviceId: setWalletV2DeviceId,
        getWalletId: getWalletV2WalletId,
        onRevoked: onWalletV2SessionRevoked,
    },
};

export type WalletV2Api = typeof walletV2Api;
