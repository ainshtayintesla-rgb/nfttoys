import {
    clearWalletV2AllBiometricDevicePubKeys,
    clearWalletV2BiometricDevicePubKey,
} from './biometric';
import { isWalletV2ApiError } from './errors';
import { resetWalletV2LocalAuthState } from './settings';
import { clearWalletV2Session, getWalletV2DeviceId } from './tokenStore';

const FATAL_SESSION_ERROR_CODES = new Set<string>([
    'INVALID_REFRESH_TOKEN',
    'SESSION_REVOKED',
    'WALLET_SESSION_MISSING',
    'WALLET_NOT_FOUND',
    'DEVICE_MISMATCH',
]);

export type WalletV2BootstrapFailureKind = 'fatal' | 'transient';

function normalizeOptionalString(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    return normalized || null;
}

export function isWalletV2FatalSessionError(error: unknown): boolean {
    if (!isWalletV2ApiError(error)) {
        return false;
    }

    return FATAL_SESSION_ERROR_CODES.has(error.code);
}

export function resolveWalletV2BootstrapFailureKind(error: unknown): WalletV2BootstrapFailureKind {
    return isWalletV2FatalSessionError(error) ? 'fatal' : 'transient';
}

export function resetWalletV2ClientAuthState(params: {
    walletId?: string | null;
    deviceId?: string | null;
    clearAllWalletSettings?: boolean;
} = {}): void {
    const normalizedWalletId = normalizeOptionalString(params.walletId);
    const normalizedDeviceId = normalizeOptionalString(params.deviceId) ?? getWalletV2DeviceId();
    const shouldClearAllWalletSettings = params.clearAllWalletSettings ?? !normalizedWalletId;

    resetWalletV2LocalAuthState({
        walletId: normalizedWalletId,
        clearAllWalletSettings: shouldClearAllWalletSettings,
    });

    if (normalizedDeviceId) {
        clearWalletV2BiometricDevicePubKey(normalizedDeviceId);
    } else {
        clearWalletV2AllBiometricDevicePubKeys();
    }

    clearWalletV2Session();
}
