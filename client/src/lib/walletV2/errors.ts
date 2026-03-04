export interface WalletV2ApiErrorDetails {
    [key: string]: unknown;
}

export interface WalletV2ApiErrorOptions {
    status?: number;
    code?: string;
    details?: WalletV2ApiErrorDetails;
    cause?: unknown;
}

export class WalletV2ApiError extends Error {
    public readonly status: number;

    public readonly code: string;

    public readonly details?: WalletV2ApiErrorDetails;

    public readonly cause?: unknown;

    constructor(message: string, options: WalletV2ApiErrorOptions = {}) {
        super(message);
        this.name = 'WalletV2ApiError';
        this.status = typeof options.status === 'number' ? options.status : 0;
        this.code = options.code || 'UNKNOWN_ERROR';
        this.details = options.details;
        this.cause = options.cause;
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    return normalized || null;
}

export function isWalletV2ApiError(error: unknown): error is WalletV2ApiError {
    return error instanceof WalletV2ApiError;
}

export function normalizeWalletV2Error(params: {
    status?: number;
    payload?: unknown;
    fallbackCode?: string;
    fallbackMessage?: string;
    cause?: unknown;
}): WalletV2ApiError {
    const {
        status = 0,
        payload,
        fallbackCode = 'UNKNOWN_ERROR',
        fallbackMessage = 'Wallet request failed',
        cause,
    } = params;

    if (payload instanceof WalletV2ApiError) {
        return payload;
    }

    const payloadRecord = asRecord(payload);
    const payloadError = asRecord(payloadRecord?.error);
    const payloadStatusRaw = payloadRecord?.status;
    const payloadStatus = typeof payloadStatusRaw === 'number' && Number.isFinite(payloadStatusRaw)
        ? payloadStatusRaw
        : status;
    const code = asNonEmptyString(payloadError?.code) || fallbackCode;
    const message = asNonEmptyString(payloadError?.message) || fallbackMessage;
    const details = payloadRecord
        ? Object.fromEntries(
            Object.entries(payloadRecord)
                .filter(([key]) => key !== 'success' && key !== 'error'),
        )
        : undefined;

    return new WalletV2ApiError(message, {
        status: payloadStatus,
        code,
        details: details && Object.keys(details).length > 0 ? details : undefined,
        cause: cause ?? payload,
    });
}

