import { getWalletV2DeviceId, setWalletV2DeviceId } from './tokenStore';

export type WalletV2ResolvedPlatform = 'ios' | 'android' | 'web';
export type WalletV2BiometricVisualType = 'face' | 'touch';

export interface WalletV2DeviceInputOverrides {
    biometricSupported?: boolean;
    devicePubKey?: string | null;
}

export interface WalletV2BiometricVisualOptions {
    biometricType?: string | null;
    userAgent?: string | null;
}

let generatedDeviceId: string | null = null;

function createClientDeviceId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `wv2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function resolveWalletV2Platform(rawPlatform: string | null | undefined): WalletV2ResolvedPlatform {
    const normalized = (rawPlatform || '').trim().toLowerCase();

    if (normalized === 'ios' || normalized.includes('ios')) {
        return 'ios';
    }

    if (normalized === 'android' || normalized.includes('android')) {
        return 'android';
    }

    return 'web';
}

function normalizeValue(value: string | null | undefined): string {
    return (value || '').trim().toLowerCase();
}

function isIosUserAgent(userAgent: string | null | undefined): boolean {
    const normalized = normalizeValue(userAgent);

    if (!normalized) {
        return false;
    }

    return normalized.includes('iphone')
        || normalized.includes('ipad')
        || normalized.includes('ipod')
        || normalized.includes('ios');
}

export function resolveWalletV2BiometricVisualType(
    rawPlatform: string | null | undefined,
    options: WalletV2BiometricVisualOptions = {},
): WalletV2BiometricVisualType {
    const biometricType = normalizeValue(options.biometricType);

    if (biometricType.includes('face')) {
        return 'face';
    }

    if (biometricType.includes('finger') || biometricType.includes('touch')) {
        return 'touch';
    }

    if (resolveWalletV2Platform(rawPlatform) === 'ios') {
        return 'face';
    }

    return isIosUserAgent(options.userAgent) ? 'face' : 'touch';
}

export function ensureWalletV2DeviceId(): string {
    const storedDeviceId = getWalletV2DeviceId();

    if (storedDeviceId) {
        return storedDeviceId;
    }

    if (!generatedDeviceId) {
        generatedDeviceId = createClientDeviceId();
    }

    setWalletV2DeviceId(generatedDeviceId);

    return generatedDeviceId;
}

export function buildWalletV2DeviceInput(
    rawPlatform: string | null | undefined,
    overrides: WalletV2DeviceInputOverrides = {},
) {
    const normalizedDevicePubKey = typeof overrides.devicePubKey === 'string' && overrides.devicePubKey.trim()
        ? overrides.devicePubKey.trim()
        : null;
    const biometricSupported = normalizedDevicePubKey
        ? true
        : Boolean(overrides.biometricSupported);

    return {
        deviceId: ensureWalletV2DeviceId(),
        platform: resolveWalletV2Platform(rawPlatform),
        biometricSupported,
        devicePubKey: normalizedDevicePubKey,
    };
}
