import {
    attachTelegramInitData,
    getAuthToken,
    refreshAuthSession,
} from '../auth';
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

import { API_BASE_URL } from '../apiBaseUrl';
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

export interface WalletV2NftStakingWindow {
    opensAt: string;
    closesAt: string;
    canStake: boolean;
    reason: 'open' | 'not_open' | 'closed' | string;
}

export interface WalletV2NftStakingPositionRow {
    tokenId: string;
    status: string;
    owned: boolean;
    modelName: string | null;
    serialNumber: string | null;
    rarity: string | null;
    collectionName: string;
    tgsUrl: string | null;
    stakedAt: string;
    lastClaimAt: string;
    rewardPerHour: string;
    pendingReward: string;
    totalClaimed: string;
    canClaim: boolean;
    canUnstake: boolean;
    unstakeAvailableAt: string;
}

export interface WalletV2NftStakingAvailableRow {
    tokenId: string;
    modelName: string;
    serialNumber: string;
    rarity: string;
    collectionName: string;
    tgsUrl: string | null;
    lastTransferAt: string | null;
    mintedAt: string;
    rewardPerHour: string;
    stakeWindow: WalletV2NftStakingWindow;
}

export interface WalletV2NftStakingStateData {
    walletId: string;
    address: string;
    rewardAsset: string;
    rules: {
        windowStartHours: number;
        windowEndHours: number;
        unstakeCooldownHours: number;
    };
    summary: {
        activeCount: number;
        availableCount: number;
        pendingReward: string;
        totalClaimed: string;
    };
    positions: WalletV2NftStakingPositionRow[];
    available: WalletV2NftStakingAvailableRow[];
    timestamp: string;
}

export interface WalletV2NftStakingStakeData {
    walletId: string;
    address: string;
    rewardAsset: string;
    position: {
        tokenId: string;
        modelName: string | null;
        serialNumber: string | null;
        rarity: string | null;
        collectionName: string;
        tgsUrl: string | null;
        stakedAt: string;
        lastClaimAt: string;
        rewardPerHour: string;
        totalClaimed: string;
        stakeWindow: {
            opensAt: string;
            closesAt: string;
        };
    };
}

export interface WalletV2NftStakingClaimData {
    walletId: string;
    address: string;
    tokenId: string;
    rewardAsset: string;
    claimedAmount: string;
    position: {
        tokenId: string;
        modelName: string | null;
        serialNumber: string | null;
        rarity: string | null;
        collectionName: string;
        tgsUrl: string | null;
        stakedAt: string;
        lastClaimAt: string;
        rewardPerHour: string;
        totalClaimed: string;
    };
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

export interface WalletV2NftStakingUnstakeData {
    walletId: string;
    address: string;
    tokenId: string;
    rewardAsset: string;
    claimRewardsApplied: boolean;
    claimedAmount: string;
    position: {
        tokenId: string;
        status: string;
        modelName: string | null;
        serialNumber: string | null;
        rarity: string | null;
        collectionName: string;
        tgsUrl: string | null;
        stakedAt: string;
        lastClaimAt: string;
        rewardPerHour: string;
        totalClaimed: string;
        unstakedAt: string | null;
    };
    balance?: WalletV2BalanceRow;
    tx?: {
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


export interface WalletV2NftStoryShareData {
    walletId: string;
    tokenId: string;
    shareId: string;
    rewardAsset: string;
    streakDay: number;
    bonusAmount: string;
    boostMultiplier: number;
    boostExpiresAt: string | null;
    status: string;
    verificationCode: string;
    sharedAt: string;
    balance: {
        asset: string;
        available: string;
        locked: string;
        updatedAt: string;
    } | null;
    tx: {
        id: string;
        status: string;
        asset: string;
        amount: string;
        createdAt: string;
        completedAt: string | null;
    } | null;
}

export interface WalletV2NftStoryShareStateData {
    walletId: string;
    tokenId: string;
    isStaked: boolean;
    canShare: boolean;
    nextShareAt: string | null;
    currentStreak: number;
    streakActive: boolean;
    nextMultiplier: number;
    totalShares: number;
    lastSharedAt: string | null;
    cooldownHours: number;
    streakWindowHours: number;
    maxStreakMultiplier: number;
    activeBoost: {
        boostMultiplier: number;
        boostExpiresAt: string;
        status: string;
    } | null;
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

export interface WalletV2WalletListItem {
    id: string;
    address: string | null;
    status: string;
    createdAt: string;
    balances: WalletV2BalanceRow[];
}

export interface WalletV2WalletListData {
    wallets: WalletV2WalletListItem[];
}

export interface WalletV2SwitchPayload {
    walletId: string;
    pin: string;
    device: WalletV2DeviceInput;
}

export interface WalletV2SwitchData {
    wallet: WalletV2Wallet;
    session: WalletV2SessionInfo;
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
        || code === 'WALLET_SESSION_MISSING'
        || code === 'WALLET_NOT_FOUND';
}

function shouldRetryViaRefresh(error: WalletV2ApiError): boolean {
    return error.status === SESSION_REFRESH_RETRY_STATUS || error.code === SESSION_REFRESH_RETRY_CODE;
}

async function createLegacyAuthHeaders(): Promise<Headers> {
    const headers = new Headers();
    const token = getAuthToken();

    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    attachTelegramInitData(headers);

    if (headers.has('Authorization') || headers.has('X-Telegram-Init-Data')) {
        return headers;
    }

    await refreshAuthSession();

    const refreshedToken = getAuthToken();
    if (refreshedToken) {
        headers.set('Authorization', `Bearer ${refreshedToken}`);
    }

    attachTelegramInitData(headers);

    if (headers.has('Authorization') || headers.has('X-Telegram-Init-Data')) {
        return headers;
    }

    throw new WalletV2ApiError('Login required', {
        status: 401,
        code: 'UNAUTHORIZED',
    });
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

    attachTelegramInitData(headers);

    if (requestInit.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    if (requiresWalletSession && !headers.has('Authorization')) {
        // Proactive refresh: if token expires within 30 seconds, refresh before sending request
        const session = getWalletV2Session();
        const PROACTIVE_REFRESH_THRESHOLD_MS = 30 * 1000;
        if (
            session?.accessToken &&
            session?.accessTokenExpiresAt &&
            Date.now() + PROACTIVE_REFRESH_THRESHOLD_MS >= session.accessTokenExpiresAt
        ) {
            try {
                await refreshWalletV2SessionInternal();
            } catch {
                // If proactive refresh fails, proceed with current token — 401 handler will retry
            }
        }

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
    async listWallets(): Promise<WalletV2WalletListItem[]> {
        const headers = await createLegacyAuthHeaders();
        const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2WalletListData>>('/wallets', {
            requiresWalletSession: false,
            headers,
        });

        return response.data.wallets || [];
    },

    async switchWallet(payload: WalletV2SwitchPayload): Promise<WalletV2SwitchData> {
        const headers = await createLegacyAuthHeaders();
        const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2SwitchData>>('/wallet/switch', {
            method: 'POST',
            requiresWalletSession: false,
            headers,
            body: JSON.stringify(payload),
        });

        setWalletV2DeviceId(payload.device.deviceId);
        persistWalletV2Session({
            walletId: response.data.wallet.id,
            session: response.data.session,
        });

        return response.data;
    },

    async create(payload: WalletV2CreatePayload): Promise<WalletV2CreateData> {
        const headers = await createLegacyAuthHeaders();
        const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2CreateData>>('/wallet/create', {
            method: 'POST',
            requiresWalletSession: false,
            headers,
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
        const headers = await createLegacyAuthHeaders();
        const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2ImportData>>('/wallet/import', {
            method: 'POST',
            requiresWalletSession: false,
            headers,
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

    nftStaking: {
        async state(walletId?: string): Promise<WalletV2NftStakingStateData> {
            const resolvedWalletId = resolveWalletId(walletId);
            const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2NftStakingStateData>>(
                `/wallet/${encodeURIComponent(resolvedWalletId)}/nft-staking/state`,
            );

            setWalletV2WalletId(response.data.walletId);

            return response.data;
        },

        async stake(payload: { walletId?: string; tokenId: string }): Promise<WalletV2NftStakingStakeData> {
            const resolvedWalletId = resolveWalletId(payload.walletId);
            const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2NftStakingStakeData>>(
                `/wallet/${encodeURIComponent(resolvedWalletId)}/nft-staking/stake`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        tokenId: payload.tokenId,
                    }),
                },
            );

            setWalletV2WalletId(response.data.walletId);

            return response.data;
        },

        async claim(payload: { walletId?: string; tokenId: string }): Promise<WalletV2NftStakingClaimData> {
            const resolvedWalletId = resolveWalletId(payload.walletId);
            const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2NftStakingClaimData>>(
                `/wallet/${encodeURIComponent(resolvedWalletId)}/nft-staking/claim`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        tokenId: payload.tokenId,
                    }),
                },
            );

            setWalletV2WalletId(response.data.walletId);

            return response.data;
        },

        async unstake(payload: { walletId?: string; tokenId: string; claimRewards?: boolean }): Promise<WalletV2NftStakingUnstakeData> {
            const resolvedWalletId = resolveWalletId(payload.walletId);
            const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2NftStakingUnstakeData>>(
                `/wallet/${encodeURIComponent(resolvedWalletId)}/nft-staking/unstake`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        tokenId: payload.tokenId,
                        ...(typeof payload.claimRewards === 'boolean'
                            ? { claimRewards: payload.claimRewards }
                            : {}),
                    }),
                },
            );

            setWalletV2WalletId(response.data.walletId);

            return response.data;
        },

        async storyShare(payload: { walletId?: string; tokenId: string }): Promise<WalletV2NftStoryShareData> {
            const resolvedWalletId = resolveWalletId(payload.walletId);
            const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2NftStoryShareData>>(
                `/wallet/${encodeURIComponent(resolvedWalletId)}/nft-staking/story-share`,
                {
                    method: 'POST',
                    body: JSON.stringify({ tokenId: payload.tokenId }),
                },
            );
            return response.data;
        },

        async storyShareState(payload: { walletId?: string; tokenId: string }): Promise<WalletV2NftStoryShareStateData> {
            const resolvedWalletId = resolveWalletId(payload.walletId);
            const response = await walletV2Fetch<WalletV2ApiEnvelope<WalletV2NftStoryShareStateData>>(
                `/wallet/${encodeURIComponent(resolvedWalletId)}/nft-staking/story-share/${encodeURIComponent(payload.tokenId)}`,
            );
            return response.data;
        },
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
