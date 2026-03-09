/**
 * API Configuration
 * Centralized API endpoint configuration
 */
import { API_BASE_URL } from './apiBaseUrl';
import { getAuthToken } from './auth';
import { walletV2Api } from './walletV2/api';

/**
 * Make API request
 */
export async function apiFetch<T = any>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers = new Headers(options.headers || {});
    const token = getAuthToken();

    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
}

export interface AdminUpdateStatusResponse {
    success: boolean;
    runMode: 'development' | 'production';
    branch: string;
    settings: {
        intervalMinutes: number;
        autoUpdateEnabled: boolean;
    };
    autoUpdateActive: boolean;
    state: {
        isChecking: boolean;
        isUpdating: boolean;
        hasUpdate: boolean;
        current: {
            full: string | null;
            short: string | null;
            date: string | null;
            subject: string | null;
            version: string | null;
        };
        remote: {
            full: string | null;
            short: string | null;
            date: string | null;
            subject: string | null;
            version: string | null;
        };
        changelog: {
            latestTitle: string | null;
            latestBody: string | null;
        };
        lastCheckedAt: string | null;
        lastUpdatedAt: string | null;
        lastAutoUpdatedAt: string | null;
        lastError: string | null;
    };
}

export interface AdminWalletLookupUser {
    id: string;
    username: string | null;
    firstName: string | null;
    photoUrl: string | null;
}

export interface AdminWalletLookupTarget {
    walletAddress: string;
    walletFriendly: string;
    user: AdminWalletLookupUser | null;
}

interface AdminWalletLookupResponse {
    success: boolean;
    target: AdminWalletLookupTarget | null;
}

interface AdminWalletTopupResponse {
    success: boolean;
    target: AdminWalletLookupTarget;
    operation: WalletOperationItem;
}

export interface AdminUserbotSessionData {
    id: string;
    phone: string;
    status: string;
    errorMessage: string | null;
    lastActiveAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface AdminUserbotSessionResponse {
    success: boolean;
    session: AdminUserbotSessionData | null;
    schemaReady: boolean;
}

export interface AdminUserbotVerifyResponse {
    success: boolean;
    sessionId?: string;
    status?: string;
    requires2fa?: boolean;
}

interface WalletSummary {
    address: string;
    friendlyAddress: string;
    nftCount: number;
    balance: number;
    createdAt: string | null;
}

interface WalletOperationItem {
    id: string;
    type: 'topup' | 'withdraw' | 'send' | 'receive';
    amount: number;
    currency: string;
    status: string;
    fromAddress: string | null;
    fromFriendly: string | null;
    toAddress: string | null;
    toFriendly: string | null;
    memo: string | null;
    feeAmount: number | null;
    feeCurrency: string | null;
    createdAt: string;
}

interface WalletMutationResponse {
    success: boolean;
    wallet: WalletSummary;
    operation: WalletOperationItem;
}

interface WalletOperationsResponse {
    success: boolean;
    items: WalletOperationItem[];
    nextCursor: string | null;
    hasMore: boolean;
}

interface WalletRecipientLookupResponse {
    success: boolean;
    recipient: {
        id: string;
        username: string | null;
        firstName: string | null;
        photoUrl: string | null;
        walletFriendly: string | null;
    } | null;
}

/**
 * API methods
 */
export const api = {
    // Auth
    auth: {
        telegram: (initData: string) =>
            apiFetch('/auth/telegram', {
                method: 'POST',
                body: JSON.stringify({ initData }),
            }),
    },

    // QR
    qr: {
        check: (token: string) =>
            apiFetch(`/qr/activate?token=${encodeURIComponent(token)}`),

        activate: (data: { token: string; userId?: string; username?: string; userPhoto?: string; firstName?: string }) =>
            apiFetch('/qr/activate', {
                method: 'POST',
                body: JSON.stringify(data),
            }),

        create: (data: { modelName: string; serialNumber: number }) =>
            apiFetch('/qr/create', {
                method: 'POST',
                body: JSON.stringify(data),
            }),

        createBatch: (data: { items: Array<{ modelName: string; serialNumber: number }> }) =>
            apiFetch('/qr/create-batch', {
                method: 'POST',
                body: JSON.stringify(data),
            }),

        delete: (nfcId: string) =>
            apiFetch(`/qr/delete?nfcId=${encodeURIComponent(nfcId)}`, {
                method: 'DELETE',
            }),

        list: () => apiFetch('/qr/list'),
    },

    // NFT
    nft: {
        get: (tokenId: string) => apiFetch(`/nft/${tokenId}`),

        my: (params: { userId?: string; wallet?: string }) => {
            const query = new URLSearchParams();
            if (params.userId) query.set('userId', params.userId);
            if (params.wallet) query.set('wallet', params.wallet);
            return apiFetch(`/nft/my?${query.toString()}`);
        },

        transfer: (
            data: {
                tokenId: string;
                fromUserId?: string;
                toAddress?: string;
                toUsername?: string;
                memo?: string;
                initData?: string;
            },
        ) =>
            apiFetch('/nft/transfer', {
                method: 'POST',
                body: JSON.stringify(data),
            }),

        findRecipientByUsername: (username: string, initData?: string) => {
            const query = new URLSearchParams({ username });
            const headers = initData ? { 'X-Telegram-Init-Data': initData } : undefined;
            return apiFetch<{
                success: boolean;
                recipient: {
                    id: string;
                    username: string | null;
                    firstName: string | null;
                    photoUrl: string | null;
                    walletFriendly: string | null;
                } | null;
            }>(`/nft/recipient/search?${query.toString()}`, { headers });
        },
    },

    // Transactions
    transactions: {
        list: (params: { from?: string; to?: string; limit?: number }) => {
            const query = new URLSearchParams();

            if (params.from) query.set('from', params.from);
            if (params.to) query.set('to', params.to);
            if (typeof params.limit === 'number') query.set('limit', String(params.limit));

            return apiFetch<{
                success: boolean;
                transactions: Array<{
                    id: string;
                    txHash: string;
                    type: string;
                    direction: 'in' | 'out';
                    amount: number;
                    asset: string;
                    from: string | null;
                    fromFriendly: string | null;
                    fromUser: {
                        id: string;
                        username: string | null;
                        firstName: string | null;
                        photoUrl: string | null;
                    } | null;
                    to: string | null;
                    toFriendly: string | null;
                    toUser: {
                        id: string;
                        username: string | null;
                        firstName: string | null;
                        photoUrl: string | null;
                    } | null;
                    tokenId: string | null;
                    modelName: string | null;
                    serialNumber: string | null;
                    collectionName: string | null;
                    tgsUrl: string | null;
                    status: string;
                    timestamp: string;
                    fee: string | null;
                    memo: string | null;
                }>;
            }>(`/transactions?${query.toString()}`);
        },
    },

    // Referrals
    referrals: {
        getOverview: () =>
            apiFetch<{
                success: boolean;
                referral: {
                    referralCode: string;
                    botUsername: string | null;
                    total: number;
                    joined: Array<{
                        id: string;
                        username: string | null;
                        firstName: string | null;
                        photoUrl: string | null;
                        joinedAt: string;
                    }>;
                };
            }>('/referrals/overview'),
    },

    // Notifications
    notifications: {
        getPreferences: () =>
            apiFetch<{
                success: boolean;
                preferences: {
                    telegramId: string;
                    writeAccessStatus: 'unknown' | 'allowed' | 'denied' | 'blocked';
                    hasWriteAccess: boolean;
                    botBlocked: boolean;
                    botStarted: boolean;
                    canManageNotifications: boolean;
                    notificationsEnabled: boolean;
                    types: {
                        nftReceived: boolean;
                    };
                    botStartUrl: string;
                    updatedAt?: string;
                };
            }>('/notifications/preferences'),

        updatePreferences: (data: { notificationsEnabled?: boolean; nftReceivedEnabled?: boolean }) =>
            apiFetch<{
                success: boolean;
                preferences: {
                    telegramId: string;
                    writeAccessStatus: 'unknown' | 'allowed' | 'denied' | 'blocked';
                    hasWriteAccess: boolean;
                    botBlocked: boolean;
                    botStarted: boolean;
                    canManageNotifications: boolean;
                    notificationsEnabled: boolean;
                    types: {
                        nftReceived: boolean;
                    };
                    botStartUrl: string;
                    updatedAt?: string;
                };
            }>('/notifications/preferences', {
                method: 'POST',
                body: JSON.stringify(data),
            }),

        updateWriteAccess: (data: { status: 'unknown' | 'allowed' | 'denied' | 'blocked'; botStarted?: boolean }) =>
            apiFetch<{
                success: boolean;
                preferences: {
                    telegramId: string;
                    writeAccessStatus: 'unknown' | 'allowed' | 'denied' | 'blocked';
                    hasWriteAccess: boolean;
                    botBlocked: boolean;
                    botStarted: boolean;
                    canManageNotifications: boolean;
                    notificationsEnabled: boolean;
                    types: {
                        nftReceived: boolean;
                    };
                    botStartUrl: string;
                    updatedAt?: string;
                };
            }>('/notifications/write-access', {
                method: 'POST',
                body: JSON.stringify(data),
            }),
    },

    // Admin
    admin: {
        dbStats: () => apiFetch('/admin/db/stats'),

        purgeNfts: (confirmation: string) =>
            apiFetch('/admin/db/purge-nfts', {
                method: 'POST',
                body: JSON.stringify({ confirmation }),
            }),

        purgeUsers: (confirmation: string) =>
            apiFetch('/admin/db/purge-users', {
                method: 'POST',
                body: JSON.stringify({ confirmation }),
            }),

        updatesStatus: () =>
            apiFetch<AdminUpdateStatusResponse>('/admin/updates/status'),

        checkUpdates: () =>
            apiFetch<AdminUpdateStatusResponse>('/admin/updates/check', {
                method: 'POST',
                body: JSON.stringify({}),
            }),

        applyUpdate: () =>
            apiFetch<AdminUpdateStatusResponse>('/admin/updates/apply', {
                method: 'POST',
                body: JSON.stringify({}),
            }),

        saveUpdateSettings: (data: { intervalMinutes: number; autoUpdateEnabled: boolean }) =>
            apiFetch<AdminUpdateStatusResponse>('/admin/updates/settings', {
                method: 'POST',
                body: JSON.stringify(data),
            }),

        lookupWalletRecipient: (params: { username?: string; wallet?: string }) => {
            const query = new URLSearchParams();
            if (params.username) query.set('username', params.username);
            if (params.wallet) query.set('wallet', params.wallet);
            const queryString = query.toString();

            return apiFetch<AdminWalletLookupResponse>(
                `/admin/wallet/recipient/search${queryString ? `?${queryString}` : ''}`,
            );
        },

        topupWallet: (data: { amount: number; wallet: string; transactionId: string }) =>
            apiFetch<AdminWalletTopupResponse>('/admin/wallet/topup', {
                method: 'POST',
                body: JSON.stringify(data),
            }),

        userbotSession: () =>
            apiFetch<AdminUserbotSessionResponse>('/admin/userbot/session'),

        userbotInit: (phone: string) =>
            apiFetch<{ success: boolean; sessionId: string; status: string }>('/admin/userbot/session/init', {
                method: 'POST',
                body: JSON.stringify({ phone }),
            }),

        userbotVerify: (data: { sessionId: string; code?: string; password?: string }) =>
            apiFetch<AdminUserbotVerifyResponse>('/admin/userbot/session/verify', {
                method: 'POST',
                body: JSON.stringify(data),
            }),

        userbotDisconnect: (sessionId: string) =>
            apiFetch<{ success: boolean; status: string }>('/admin/userbot/session/disconnect', {
                method: 'POST',
                body: JSON.stringify({ sessionId }),
            }),

        storyBoostStats: () =>
            apiFetch<{ success: boolean; stats: { totalShares: number; activeBoosts: number; verifiedShares: number } | null; schemaReady: boolean }>('/admin/story-boost/stats'),
    },

    // Wallet
    wallet: {
        create: (userId: string) =>
            apiFetch<{
                success: boolean;
                wallet: {
                    address: string;
                    friendlyAddress: string;
                };
                existing: boolean;
            }>('/wallet/create', {
                method: 'POST',
                body: JSON.stringify({ userId }),
            }),

        info: (userId: string) =>
            apiFetch<{
                success: boolean;
                wallet: WalletSummary;
            }>(`/wallet/info?userId=${encodeURIComponent(userId)}`),

        topup: (amount: number) =>
            apiFetch<WalletMutationResponse>('/wallet/topup', {
                method: 'POST',
                body: JSON.stringify({ amount }),
            }),

        withdraw: (amount: number) =>
            apiFetch<WalletMutationResponse>('/wallet/withdraw', {
                method: 'POST',
                body: JSON.stringify({ amount }),
            }),

        send: (data: { amount: number; toUsername?: string; toAddress?: string; memo?: string }) =>
            apiFetch<WalletMutationResponse>('/wallet/send', {
                method: 'POST',
                body: JSON.stringify(data),
            }),

        operations: (params: { limit?: number; cursor?: string } = {}) => {
            const query = new URLSearchParams();
            if (typeof params.limit === 'number') query.set('limit', String(params.limit));
            if (params.cursor) query.set('cursor', params.cursor);
            const queryString = query.toString();

            return apiFetch<WalletOperationsResponse>(
                `/wallet/operations${queryString ? `?${queryString}` : ''}`,
            );
        },

        findRecipient: (params: { username?: string; wallet?: string }, initData?: string) => {
            const query = new URLSearchParams();
            if (params.username) query.set('username', params.username);
            if (params.wallet) query.set('wallet', params.wallet);
            const queryString = query.toString();
            const headers = initData ? { 'X-Telegram-Init-Data': initData } : undefined;

            return apiFetch<WalletRecipientLookupResponse>(
                `/wallet/recipient/search${queryString ? `?${queryString}` : ''}`,
                { headers },
            );
        },
    },

    // Wallet V2
    walletV2: walletV2Api,

    // Telegram
    telegram: {
        validate: (initData: string) =>
            apiFetch('/telegram/validate', {
                method: 'POST',
                body: JSON.stringify({ initData }),
            }),

        getBotInfo: () =>
            apiFetch<{
                success: boolean;
                bot: {
                    username: string | null;
                    profileUrl: string;
                    startUrl: string;
                };
            }>('/telegram/bot-info'),
    },
};

export default api;
