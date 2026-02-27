/**
 * API Configuration
 * Centralized API endpoint configuration
 */
import { getAuthToken } from './auth';

// API base URL - set to server URL in production
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

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
    },

    // Wallet
    wallet: {
        create: (userId: string) =>
            apiFetch('/wallet/create', {
                method: 'POST',
                body: JSON.stringify({ userId }),
            }),

        info: (userId: string) =>
            apiFetch(`/wallet/info?userId=${encodeURIComponent(userId)}`),
    },

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
