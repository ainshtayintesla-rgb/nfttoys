import type { IWebApp, IWebAppBiometricManager } from '@/lib/utils/telegram';

const WALLET_V2_BIO_PUBKEY_STORAGE_PREFIX = 'nfttoys_wallet_v2_bio_pubkey:';
const CALLBACK_TIMEOUT_MS = 10_000;
const MAX_REASON_LENGTH = 128;
const DEFAULT_ACCESS_REASON = 'Enable biometric confirmation for wallet transfers';
const DEFAULT_AUTH_REASON = 'Confirm wallet transfer';

export type WalletV2BiometricAuthErrorCode =
    | 'UNAVAILABLE'
    | 'ACCESS_DENIED'
    | 'TOKEN_MISSING'
    | 'AUTH_CANCELED'
    | 'SIGN_FAILED';

export interface WalletV2BiometricSnapshot {
    managerAvailable: boolean;
    biometricAvailable: boolean;
    accessGranted: boolean;
    tokenSaved: boolean;
    devicePubKey: string | null;
}

export interface WalletV2BiometricEnableResult {
    biometricSupported: boolean;
    devicePubKey: string | null;
}

export interface WalletV2BiometricAuthResult {
    signature: string | null;
    errorCode: WalletV2BiometricAuthErrorCode | null;
}

export interface WalletV2BiometricPresenceResult {
    authenticated: boolean;
    errorCode: WalletV2BiometricAuthErrorCode | null;
}

function isBrowser(): boolean {
    return typeof window !== 'undefined';
}

function resolveStorageKey(walletDeviceId: string): string {
    return `${WALLET_V2_BIO_PUBKEY_STORAGE_PREFIX}${walletDeviceId}`;
}

function getStoredDevicePubKey(walletDeviceId: string): string | null {
    if (!isBrowser() || !walletDeviceId) {
        return null;
    }

    const value = localStorage.getItem(resolveStorageKey(walletDeviceId));

    if (!value) {
        return null;
    }

    const normalized = value.trim();
    return normalized || null;
}

function setStoredDevicePubKey(walletDeviceId: string, devicePubKey: string): void {
    if (!isBrowser() || !walletDeviceId || !devicePubKey) {
        return;
    }

    localStorage.setItem(resolveStorageKey(walletDeviceId), devicePubKey);
}

export function clearWalletV2BiometricDevicePubKey(walletDeviceId: string | null | undefined): void {
    const normalizedDeviceId = typeof walletDeviceId === 'string' ? walletDeviceId.trim() : '';

    if (!isBrowser() || !normalizedDeviceId) {
        return;
    }

    localStorage.removeItem(resolveStorageKey(normalizedDeviceId));
}

export function clearWalletV2AllBiometricDevicePubKeys(): void {
    if (!isBrowser()) {
        return;
    }

    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);

        if (!key || !key.startsWith(WALLET_V2_BIO_PUBKEY_STORAGE_PREFIX)) {
            continue;
        }

        localStorage.removeItem(key);
    }
}

function resolveBiometricManager(webApp: IWebApp | null | undefined): IWebAppBiometricManager | null {
    return webApp?.BiometricManager || null;
}

function normalizeReason(rawReason: string | undefined, fallback: string): string {
    const normalized = (rawReason || '').trim() || fallback;
    return normalized.slice(0, MAX_REASON_LENGTH);
}

function toBase64Url(bytes: Uint8Array): string {
    let binary = '';

    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });

    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array | null {
    const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');

    if (!normalized) {
        return null;
    }

    const paddingNeeded = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(paddingNeeded);

    try {
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);

        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }

        return bytes;
    } catch {
        return null;
    }
}

function hasSubtleCrypto(): boolean {
    return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}

function isCryptoKeyPair(candidate: CryptoKeyPair | CryptoKey): candidate is CryptoKeyPair {
    return 'privateKey' in candidate && 'publicKey' in candidate;
}

function callbackWithTimeout<T>(executor: (done: (value: T) => void) => void, fallback: T, timeoutMs = CALLBACK_TIMEOUT_MS): Promise<T> {
    return new Promise((resolve) => {
        let completed = false;
        const timeoutId = window.setTimeout(() => {
            if (completed) {
                return;
            }

            completed = true;
            resolve(fallback);
        }, timeoutMs);

        const done = (value: T) => {
            if (completed) {
                return;
            }

            completed = true;
            window.clearTimeout(timeoutId);
            resolve(value);
        };

        executor(done);
    });
}

async function initBiometricManager(manager: IWebAppBiometricManager): Promise<void> {
    if (manager.isInited) {
        return;
    }

    await callbackWithTimeout<void>((done) => {
        try {
            manager.init(() => {
                done(undefined);
            });
        } catch {
            done(undefined);
        }
    }, undefined, 6_000);
}

async function requestBiometricAccess(manager: IWebAppBiometricManager, reason?: string): Promise<boolean> {
    if (manager.isAccessGranted) {
        return true;
    }

    const resolvedReason = normalizeReason(reason, DEFAULT_ACCESS_REASON);
    const granted = await callbackWithTimeout<boolean>((done) => {
        try {
            manager.requestAccess({ reason: resolvedReason }, (nextGranted) => {
                done(Boolean(nextGranted));
            });
        } catch {
            done(false);
        }
    }, false);

    return granted || manager.isAccessGranted;
}

async function updateBiometricToken(manager: IWebAppBiometricManager, token: string): Promise<boolean> {
    const updated = await callbackWithTimeout<boolean>((done) => {
        try {
            manager.updateBiometricToken(token, (nextUpdated) => {
                done(Boolean(nextUpdated));
            });
        } catch {
            done(false);
        }
    }, false);

    return updated || manager.isBiometricTokenSaved;
}

async function authenticateBiometric(manager: IWebAppBiometricManager, reason?: string): Promise<string | null> {
    const resolvedReason = normalizeReason(reason, DEFAULT_AUTH_REASON);
    const token = await callbackWithTimeout<string | null>((done) => {
        try {
            manager.authenticate({ reason: resolvedReason }, (authenticated, biometricToken) => {
                if (!authenticated || typeof biometricToken !== 'string' || !biometricToken.trim()) {
                    done(null);
                    return;
                }

                done(biometricToken.trim());
            });
        } catch {
            done(null);
        }
    }, null);

    return token;
}

async function generateSigningKeyPair(): Promise<{ publicKey: string; privateKey: string } | null> {
    if (!hasSubtleCrypto()) {
        return null;
    }

    try {
        const generatedKey = await crypto.subtle.generateKey(
            { name: 'Ed25519' },
            true,
            ['sign', 'verify'],
        );

        if (!isCryptoKeyPair(generatedKey)) {
            return null;
        }

        const publicKeyRaw = await crypto.subtle.exportKey('raw', generatedKey.publicKey);
        const privateKeyPkcs8 = await crypto.subtle.exportKey('pkcs8', generatedKey.privateKey);

        return {
            publicKey: toBase64Url(new Uint8Array(publicKeyRaw)),
            privateKey: toBase64Url(new Uint8Array(privateKeyPkcs8)),
        };
    } catch {
        return null;
    }
}

async function signWithPrivateKey(privateKeyBase64Url: string, message: string): Promise<string | null> {
    if (!hasSubtleCrypto()) {
        return null;
    }

    const privateKeyBytes = fromBase64Url(privateKeyBase64Url);

    if (!privateKeyBytes) {
        return null;
    }

    try {
        const privateKeyBuffer = Uint8Array.from(privateKeyBytes);
        const privateKey = await crypto.subtle.importKey(
            'pkcs8',
            privateKeyBuffer,
            { name: 'Ed25519' },
            false,
            ['sign'],
        );
        const encodedMessage = new TextEncoder().encode(message);
        const signature = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, encodedMessage);
        return toBase64Url(new Uint8Array(signature));
    } catch {
        return null;
    }
}

export async function getWalletV2BiometricSnapshot(
    webApp: IWebApp | null | undefined,
    walletDeviceId: string,
): Promise<WalletV2BiometricSnapshot> {
    const manager = resolveBiometricManager(webApp);

    if (!manager) {
        return {
            managerAvailable: false,
            biometricAvailable: false,
            accessGranted: false,
            tokenSaved: false,
            devicePubKey: null,
        };
    }

    await initBiometricManager(manager);

    return {
        managerAvailable: true,
        biometricAvailable: Boolean(manager.isBiometricAvailable),
        accessGranted: Boolean(manager.isAccessGranted),
        tokenSaved: Boolean(manager.isBiometricTokenSaved),
        devicePubKey: getStoredDevicePubKey(walletDeviceId),
    };
}

export async function enableWalletV2Biometric(params: {
    webApp: IWebApp | null | undefined;
    walletDeviceId: string;
    reason?: string;
}): Promise<WalletV2BiometricEnableResult> {
    const manager = resolveBiometricManager(params.webApp);

    if (!manager || !params.walletDeviceId) {
        return {
            biometricSupported: false,
            devicePubKey: null,
        };
    }

    await initBiometricManager(manager);

    if (!manager.isBiometricAvailable) {
        return {
            biometricSupported: false,
            devicePubKey: null,
        };
    }

    const granted = await requestBiometricAccess(manager, params.reason);

    if (!granted) {
        return {
            biometricSupported: false,
            devicePubKey: null,
        };
    }

    let devicePubKey = getStoredDevicePubKey(params.walletDeviceId);
    const tokenSaved = Boolean(manager.isBiometricTokenSaved);

    if (!devicePubKey || !tokenSaved) {
        const keyPair = await generateSigningKeyPair();

        if (!keyPair) {
            return {
                biometricSupported: false,
                devicePubKey: null,
            };
        }

        const tokenUpdated = await updateBiometricToken(manager, keyPair.privateKey);

        if (!tokenUpdated) {
            // Clear any stale pubKey from localStorage — token and pubKey must stay in sync.
            localStorage.removeItem(resolveStorageKey(params.walletDeviceId));
            return {
                biometricSupported: false,
                devicePubKey: null,
            };
        }

        devicePubKey = keyPair.publicKey;
        setStoredDevicePubKey(params.walletDeviceId, keyPair.publicKey);
    }

    return {
        biometricSupported: Boolean(devicePubKey),
        devicePubKey,
    };
}

export async function signWalletV2ChallengeWithBiometric(params: {
    webApp: IWebApp | null | undefined;
    txId: string;
    challengeId: string;
    reason?: string;
}): Promise<WalletV2BiometricAuthResult> {
    const manager = resolveBiometricManager(params.webApp);

    if (!manager) {
        return { signature: null, errorCode: 'UNAVAILABLE' };
    }

    await initBiometricManager(manager);

    if (!manager.isBiometricAvailable) {
        return { signature: null, errorCode: 'UNAVAILABLE' };
    }

    const accessGranted = await requestBiometricAccess(manager, params.reason);

    if (!accessGranted) {
        return { signature: null, errorCode: 'ACCESS_DENIED' };
    }

    if (!manager.isBiometricTokenSaved) {
        return { signature: null, errorCode: 'TOKEN_MISSING' };
    }

    const biometricToken = await authenticateBiometric(manager, params.reason);

    if (!biometricToken) {
        return { signature: null, errorCode: 'AUTH_CANCELED' };
    }

    const signature = await signWithPrivateKey(biometricToken, `${params.txId}:${params.challengeId}`);

    if (!signature) {
        return { signature: null, errorCode: 'SIGN_FAILED' };
    }

    return { signature, errorCode: null };
}

export async function authenticateWalletV2WithBiometric(params: {
    webApp: IWebApp | null | undefined;
    reason?: string;
}): Promise<WalletV2BiometricPresenceResult> {
    const manager = resolveBiometricManager(params.webApp);

    if (!manager) {
        return { authenticated: false, errorCode: 'UNAVAILABLE' };
    }

    await initBiometricManager(manager);

    if (!manager.isBiometricAvailable) {
        return { authenticated: false, errorCode: 'UNAVAILABLE' };
    }

    const accessGranted = await requestBiometricAccess(manager, params.reason);

    if (!accessGranted) {
        return { authenticated: false, errorCode: 'ACCESS_DENIED' };
    }

    if (!manager.isBiometricTokenSaved) {
        return { authenticated: false, errorCode: 'TOKEN_MISSING' };
    }

    const biometricToken = await authenticateBiometric(manager, params.reason);

    if (!biometricToken) {
        return { authenticated: false, errorCode: 'AUTH_CANCELED' };
    }

    return {
        authenticated: true,
        errorCode: null,
    };
}
