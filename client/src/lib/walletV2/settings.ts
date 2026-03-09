import { type EncryptedMnemonic, isEncryptedMnemonic } from './mnemonicCrypto';

const WALLET_V2_SETTINGS_STORAGE_PREFIX = 'nfttoys_wallet_v2_settings:';
const WALLET_V2_AUTH_STATE_STORAGE_KEY = 'nfttoys_wallet_v2_auth_state';
const WALLET_V2_ENCRYPTED_MNEMONIC_PREFIX = 'nfttoys_wallet_v2_emnem:';
const MNEMONIC_WORDS_COUNT = 24;
const MNEMONIC_WORD_REGEX = /^[a-z]+$/;
const DEFAULT_REMEMBER_TIMEOUT_MINUTES = 5;

export const WALLET_V2_REMEMBER_TIMEOUT_MINUTES_OPTIONS = [0, 5, 15, 30, 60] as const;

interface WalletV2StoredSettings {
    biometricConfirmationEnabled?: unknown;
    mnemonicWords?: unknown;
}

interface WalletV2LocalSettings {
    biometricConfirmationEnabled: boolean;
    mnemonicWords: string[];
}

interface WalletV2StoredAuthState {
    hasPin?: unknown;
    rememberTimeoutMinutes?: unknown;
    unlockedWalletId?: unknown;
    unlockedUntil?: unknown;
}

interface WalletV2AuthState {
    hasPin: boolean;
    rememberTimeoutMinutes: number;
    unlockedWalletId: string | null;
    unlockedUntil: number;
}

function isBrowser(): boolean {
    return typeof window !== 'undefined';
}

function normalizeWalletId(walletId: string | null | undefined): string | null {
    if (typeof walletId !== 'string') {
        return null;
    }

    const normalized = walletId.trim();
    return normalized || null;
}

function resolveStorageKey(walletId: string): string {
    return `${WALLET_V2_SETTINGS_STORAGE_PREFIX}${walletId}`;
}

function sanitizeMnemonicWords(rawValue: unknown): string[] {
    if (!Array.isArray(rawValue)) {
        return [];
    }

    const words = rawValue
        .map((word) => (typeof word === 'string' ? word.trim().toLowerCase() : ''))
        .filter(Boolean)
        .filter((word) => MNEMONIC_WORD_REGEX.test(word));

    return words.length === MNEMONIC_WORDS_COUNT ? words : [];
}

function getDefaultSettings(): WalletV2LocalSettings {
    return {
        biometricConfirmationEnabled: true,
        mnemonicWords: [],
    };
}

function sanitizeRememberTimeoutMinutes(rawValue: unknown): number {
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
        return DEFAULT_REMEMBER_TIMEOUT_MINUTES;
    }

    const normalized = Math.max(0, Math.floor(rawValue));
    return WALLET_V2_REMEMBER_TIMEOUT_MINUTES_OPTIONS.includes(
        normalized as (typeof WALLET_V2_REMEMBER_TIMEOUT_MINUTES_OPTIONS)[number],
    )
        ? normalized
        : DEFAULT_REMEMBER_TIMEOUT_MINUTES;
}

function getDefaultAuthState(): WalletV2AuthState {
    return {
        hasPin: false,
        rememberTimeoutMinutes: DEFAULT_REMEMBER_TIMEOUT_MINUTES,
        unlockedWalletId: null,
        unlockedUntil: 0,
    };
}

function readAuthState(): WalletV2AuthState {
    if (!isBrowser()) {
        return getDefaultAuthState();
    }

    const rawValue = localStorage.getItem(WALLET_V2_AUTH_STATE_STORAGE_KEY);

    if (!rawValue) {
        return getDefaultAuthState();
    }

    try {
        const parsed = JSON.parse(rawValue) as WalletV2StoredAuthState;
        const hasPin = typeof parsed.hasPin === 'boolean' ? parsed.hasPin : false;
        const rememberTimeoutMinutes = sanitizeRememberTimeoutMinutes(parsed.rememberTimeoutMinutes);
        const unlockedWalletId = normalizeWalletId(parsed.unlockedWalletId as string | null | undefined);
        const unlockedUntil = typeof parsed.unlockedUntil === 'number' && Number.isFinite(parsed.unlockedUntil)
            ? Math.max(0, Math.floor(parsed.unlockedUntil))
            : 0;

        return {
            hasPin,
            rememberTimeoutMinutes,
            unlockedWalletId,
            unlockedUntil,
        };
    } catch {
        return getDefaultAuthState();
    }
}

function writeAuthState(nextState: WalletV2AuthState): void {
    if (!isBrowser()) {
        return;
    }

    localStorage.setItem(WALLET_V2_AUTH_STATE_STORAGE_KEY, JSON.stringify(nextState));
}

function readSettings(walletId: string): WalletV2LocalSettings {
    if (!isBrowser()) {
        return getDefaultSettings();
    }

    const rawValue = localStorage.getItem(resolveStorageKey(walletId));

    if (!rawValue) {
        return getDefaultSettings();
    }

    try {
        const parsed = JSON.parse(rawValue) as WalletV2StoredSettings;

        const biometricConfirmationEnabled = typeof parsed.biometricConfirmationEnabled === 'boolean'
            ? parsed.biometricConfirmationEnabled
            : true;

        return {
            biometricConfirmationEnabled,
            mnemonicWords: sanitizeMnemonicWords(parsed.mnemonicWords),
        };
    } catch {
        return getDefaultSettings();
    }
}

function writeSettings(walletId: string, settings: WalletV2LocalSettings): void {
    if (!isBrowser()) {
        return;
    }

    localStorage.setItem(resolveStorageKey(walletId), JSON.stringify(settings));
}

export function getWalletV2BiometricConfirmationEnabled(walletId: string | null | undefined): boolean {
    const normalizedWalletId = normalizeWalletId(walletId);

    if (!normalizedWalletId) {
        return true;
    }

    return readSettings(normalizedWalletId).biometricConfirmationEnabled;
}

export function setWalletV2BiometricConfirmationEnabled(
    walletId: string | null | undefined,
    enabled: boolean,
): void {
    const normalizedWalletId = normalizeWalletId(walletId);

    if (!normalizedWalletId) {
        return;
    }

    const current = readSettings(normalizedWalletId);

    writeSettings(normalizedWalletId, {
        ...current,
        biometricConfirmationEnabled: Boolean(enabled),
    });
}

export function getWalletV2MnemonicWords(walletId: string | null | undefined): string[] {
    const normalizedWalletId = normalizeWalletId(walletId);

    if (!normalizedWalletId) {
        return [];
    }

    return readSettings(normalizedWalletId).mnemonicWords;
}

export function setWalletV2MnemonicWords(
    walletId: string | null | undefined,
    words: string[],
): void {
    const normalizedWalletId = normalizeWalletId(walletId);

    if (!normalizedWalletId) {
        return;
    }

    const current = readSettings(normalizedWalletId);

    writeSettings(normalizedWalletId, {
        ...current,
        mnemonicWords: sanitizeMnemonicWords(words),
    });
}

export function clearWalletV2LocalSettings(walletId: string | null | undefined): void {
    const normalizedWalletId = normalizeWalletId(walletId);

    if (!isBrowser() || !normalizedWalletId) {
        return;
    }

    localStorage.removeItem(resolveStorageKey(normalizedWalletId));
}

export function clearWalletV2AllLocalSettings(): void {
    if (!isBrowser()) {
        return;
    }

    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);

        if (!key || !key.startsWith(WALLET_V2_SETTINGS_STORAGE_PREFIX)) {
            continue;
        }

        localStorage.removeItem(key);
    }
}

export function hasWalletV2StoredPin(): boolean {
    return readAuthState().hasPin;
}

export function setWalletV2StoredPinConfigured(configured: boolean): void {
    const current = readAuthState();

    writeAuthState({
        ...current,
        hasPin: Boolean(configured),
    });
}

export function getWalletV2RememberTimeoutMinutes(): number {
    return readAuthState().rememberTimeoutMinutes;
}

export function setWalletV2RememberTimeoutMinutes(minutes: number): void {
    const current = readAuthState();
    const rememberTimeoutMinutes = sanitizeRememberTimeoutMinutes(minutes);

    writeAuthState({
        ...current,
        rememberTimeoutMinutes,
    });
}

export function clearWalletV2RememberedAuth(): void {
    const current = readAuthState();

    writeAuthState({
        ...current,
        unlockedWalletId: null,
        unlockedUntil: 0,
    });
}

export function markWalletV2RememberedAuth(walletId: string | null | undefined): void {
    const normalizedWalletId = normalizeWalletId(walletId);
    const current = readAuthState();

    if (!normalizedWalletId) {
        return;
    }

    const timeoutMinutes = current.rememberTimeoutMinutes;
    const nowMs = Date.now();
    const unlockedUntil = timeoutMinutes > 0
        ? nowMs + timeoutMinutes * 60 * 1000
        : 0;

    writeAuthState({
        ...current,
        unlockedWalletId: normalizedWalletId,
        unlockedUntil,
    });
}

export function isWalletV2RememberedAuthValid(walletId: string | null | undefined): boolean {
    const normalizedWalletId = normalizeWalletId(walletId);

    if (!normalizedWalletId) {
        return false;
    }

    const current = readAuthState();

    if (current.unlockedWalletId !== normalizedWalletId) {
        return false;
    }

    if (current.rememberTimeoutMinutes <= 0) {
        return false;
    }

    return current.unlockedUntil > Date.now();
}

// ─── Encrypted mnemonic storage ──────────────────────────────────────────────

export function getWalletV2EncryptedMnemonic(walletId: string | null | undefined): EncryptedMnemonic | null {
    const nid = normalizeWalletId(walletId);
    if (!isBrowser() || !nid) return null;

    const raw = localStorage.getItem(`${WALLET_V2_ENCRYPTED_MNEMONIC_PREFIX}${nid}`);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        return isEncryptedMnemonic(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function setWalletV2EncryptedMnemonic(
    walletId: string | null | undefined,
    encrypted: EncryptedMnemonic,
): void {
    const nid = normalizeWalletId(walletId);
    if (!isBrowser() || !nid) return;

    localStorage.setItem(`${WALLET_V2_ENCRYPTED_MNEMONIC_PREFIX}${nid}`, JSON.stringify(encrypted));
}

export function hasWalletV2EncryptedMnemonic(walletId: string | null | undefined): boolean {
    return getWalletV2EncryptedMnemonic(walletId) !== null;
}

export function clearWalletV2EncryptedMnemonic(walletId: string | null | undefined): void {
    const nid = normalizeWalletId(walletId);
    if (!isBrowser() || !nid) return;

    localStorage.removeItem(`${WALLET_V2_ENCRYPTED_MNEMONIC_PREFIX}${nid}`);
}

export function resetWalletV2LocalAuthState(params: {
    walletId?: string | null;
    clearAllWalletSettings?: boolean;
} = {}): void {
    if (params.clearAllWalletSettings) {
        clearWalletV2AllLocalSettings();
    } else {
        clearWalletV2LocalSettings(params.walletId);
    }

    clearWalletV2RememberedAuth();
    setWalletV2StoredPinConfigured(false);
}
