interface TransferNotificationPayload {
    recipientTelegramId: string;
    modelName: string;
    serialNumber: string;
    rarity: string;
    tokenId: string;
    senderUsername?: string | null;
    senderFirstName?: string | null;
}

export type WriteAccessStatus = 'unknown' | 'allowed' | 'denied' | 'blocked';

export interface NotificationPreferences {
    telegramId: string;
    writeAccessStatus: WriteAccessStatus;
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
}

export interface BotMeta {
    username: string | null;
    profileUrl: string;
    startUrl: string;
}

interface BotServiceResponsePayload {
    ok?: boolean;
    error?: string;
    delivered?: boolean;
    reason?: string;
    preferences?: NotificationPreferences;
    bot?: BotMeta;
}

export interface BotServiceResult<T> {
    ok: boolean;
    status: number;
    data?: T;
    error?: string;
}

const DEFAULT_BOT_SERVICE_BASE_URL = 'http://127.0.0.1:8090';
const DEFAULT_BOT_SERVICE_NOTIFY_URL = `${DEFAULT_BOT_SERVICE_BASE_URL}/internal/notify/nft-received`;
const DEFAULT_BOT_SERVICE_TIMEOUT_MS = 7000;

function normalizeBaseUrl(url: string): string {
    return url.replace(/\/+$/, '');
}

function getBotServiceConfig() {
    const timeoutRaw = process.env.BOT_SERVICE_TIMEOUT_MS || String(DEFAULT_BOT_SERVICE_TIMEOUT_MS);
    const parsedTimeout = Number.parseInt(timeoutRaw, 10);

    const configuredNotifyUrl = (process.env.BOT_SERVICE_URL || '').trim();
    const configuredBaseUrl = (process.env.BOT_SERVICE_BASE_URL || '').trim();

    let baseUrl = configuredBaseUrl;
    if (!baseUrl && configuredNotifyUrl) {
        baseUrl = configuredNotifyUrl.replace(/\/internal\/notify\/nft-received\/?$/, '');
    }

    const finalBaseUrl = normalizeBaseUrl(baseUrl || DEFAULT_BOT_SERVICE_BASE_URL);
    const notifyUrl = configuredNotifyUrl || `${finalBaseUrl}/internal/notify/nft-received`;

    return {
        baseUrl: finalBaseUrl,
        notifyUrl,
        token: process.env.BOT_SERVICE_TOKEN || '',
        timeoutMs: Number.isNaN(parsedTimeout) ? DEFAULT_BOT_SERVICE_TIMEOUT_MS : parsedTimeout,
    };
}

async function botServiceFetch<T>(url: string, options: RequestInit = {}): Promise<BotServiceResult<T>> {
    const config = getBotServiceConfig();

    if (!config.token) {
        return {
            ok: false,
            status: 503,
            error: 'BOT_SERVICE_TOKEN is not configured',
        };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
    }, config.timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.token}`,
                ...(options.headers || {}),
            },
            signal: controller.signal,
        });

        const responseText = await response.text().catch(() => '');
        let responseJson = {} as T & { error?: string };

        if (responseText) {
            try {
                responseJson = JSON.parse(responseText) as T & { error?: string };
            } catch {
                responseJson = {} as T & { error?: string };
            }
        }

        if (!response.ok) {
            return {
                ok: false,
                status: response.status,
                error: responseJson?.error || responseText || `HTTP ${response.status}`,
            };
        }

        return {
            ok: true,
            status: response.status,
            data: responseJson,
        };
    } catch (error) {
        return {
            ok: false,
            status: 503,
            error: error instanceof Error ? error.message : 'Bot service request failed',
        };
    } finally {
        clearTimeout(timeoutId);
    }
}

function invalidBotPayloadResult(): BotServiceResult<never> {
    return {
        ok: false,
        status: 502,
        error: 'Invalid response from bot service',
    };
}

export async function notifyNftReceived(payload: TransferNotificationPayload): Promise<boolean> {
    const config = getBotServiceConfig();

    if (!config.notifyUrl) {
        console.warn('BOT_SERVICE_URL is not configured. Skipping transfer notification.');
        return false;
    }

    const requestPayload = {
        recipientTelegramId: payload.recipientTelegramId,
        modelName: payload.modelName,
        serialNumber: payload.serialNumber,
        rarity: payload.rarity,
        tokenId: payload.tokenId,
        senderUsername: payload.senderUsername || null,
        senderFirstName: payload.senderFirstName || null,
    };

    const response = await botServiceFetch<BotServiceResponsePayload>(config.notifyUrl, {
        method: 'POST',
        body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
        console.warn(`Bot service notify failed (${response.status}): ${response.error || 'unknown error'}`);
        return false;
    }

    if (!response.data?.ok) {
        return false;
    }

    if (response.data.delivered === false) {
        return false;
    }

    return true;
}

export async function fetchNotificationPreferences(telegramId: string): Promise<BotServiceResult<NotificationPreferences>> {
    const config = getBotServiceConfig();
    const endpoint = `${config.baseUrl}/internal/user/preferences?telegramId=${encodeURIComponent(telegramId)}`;
    const response = await botServiceFetch<BotServiceResponsePayload>(endpoint, { method: 'GET' });

    if (!response.ok) {
        return {
            ok: false,
            status: response.status,
            error: response.error,
        };
    }

    if (!response.data?.ok || !response.data.preferences) {
        return invalidBotPayloadResult();
    }

    return {
        ok: true,
        status: response.status,
        data: response.data.preferences,
    };
}

interface UpdateNotificationPreferencesPayload {
    telegramId: string;
    notificationsEnabled?: boolean;
    nftReceivedEnabled?: boolean;
}

export async function updateNotificationPreferences(
    payload: UpdateNotificationPreferencesPayload,
): Promise<BotServiceResult<NotificationPreferences>> {
    const config = getBotServiceConfig();
    const endpoint = `${config.baseUrl}/internal/user/preferences`;

    const response = await botServiceFetch<BotServiceResponsePayload>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        return {
            ok: false,
            status: response.status,
            error: response.error,
        };
    }

    if (!response.data?.ok || !response.data.preferences) {
        return invalidBotPayloadResult();
    }

    return {
        ok: true,
        status: response.status,
        data: response.data.preferences,
    };
}

interface UpdateWriteAccessPayload {
    telegramId: string;
    status: WriteAccessStatus;
    botStarted?: boolean;
}

export async function updateWriteAccessStatus(
    payload: UpdateWriteAccessPayload,
): Promise<BotServiceResult<NotificationPreferences>> {
    const config = getBotServiceConfig();
    const endpoint = `${config.baseUrl}/internal/user/write-access`;

    const response = await botServiceFetch<BotServiceResponsePayload>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        return {
            ok: false,
            status: response.status,
            error: response.error,
        };
    }

    if (!response.data?.ok || !response.data.preferences) {
        return invalidBotPayloadResult();
    }

    return {
        ok: true,
        status: response.status,
        data: response.data.preferences,
    };
}

export async function fetchBotMeta(): Promise<BotServiceResult<BotMeta>> {
    const config = getBotServiceConfig();
    const endpoint = `${config.baseUrl}/internal/bot/meta`;
    const response = await botServiceFetch<BotServiceResponsePayload>(endpoint, { method: 'GET' });

    if (!response.ok) {
        return {
            ok: false,
            status: response.status,
            error: response.error,
        };
    }

    if (!response.data?.ok || !response.data.bot) {
        return invalidBotPayloadResult();
    }

    return {
        ok: true,
        status: response.status,
        data: response.data.bot,
    };
}

export function getDefaultBotServiceNotifyUrl(): string {
    return DEFAULT_BOT_SERVICE_NOTIFY_URL;
}
