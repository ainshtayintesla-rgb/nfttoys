'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    IoArrowDown,
    IoArrowUp,
    IoCheckmark,
    IoCopy,
    IoFlame,
    IoRefresh,
    IoSettings,
    IoShieldCheckmark,
    IoSparkles,
    IoWallet,
    IoWarning,
} from 'react-icons/io5';
import QRCode from 'react-qr-code';

import { PinAuthScreen, type PinAuthScreenDetail } from '@/components/features/walletV2/PinAuthScreen';
import { BottomDrawer } from '@/components/ui/BottomDrawer';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DetailsTable } from '@/components/ui/DetailsTable';
import { RoundIconButton } from '@/components/ui/RoundIconButton';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { TelegramBackButton } from '@/components/ui/TelegramBackButton';
import { TgsPlayer } from '@/components/ui/TgsPlayer';
import { TxCard } from '@/components/ui/TxCard';
import { WalletPageSkeleton } from '@/components/ui/WalletPageSkeleton';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/context/LanguageContext';
import { useTelegram } from '@/lib/context/TelegramContext';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';
import { formatWalletShortLabel } from '@/lib/wallet/network';
import {
    authenticateWalletV2WithBiometric,
    enableWalletV2Biometric,
    getWalletV2BiometricSnapshot,
    signWalletV2ChallengeWithBiometric,
} from '@/lib/walletV2/biometric';
import { buildWalletV2DeviceInput, resolveWalletV2BiometricVisualType } from '@/lib/walletV2/device';
import { isWalletV2ApiError } from '@/lib/walletV2/errors';
import {
    getWalletV2BiometricConfirmationEnabled,
    hasWalletV2StoredPin,
    isWalletV2RememberedAuthValid,
    markWalletV2RememberedAuth,
    getWalletV2MnemonicWords,
    setWalletV2BiometricConfirmationEnabled,
    setWalletV2StoredPinConfigured,
    setWalletV2MnemonicWords,
} from '@/lib/walletV2/settings';
import {
    WALLET_V2_ADDRESS_PREFIX,
    formatWalletV2Address,
    sanitizeWalletV2AddressInput,
    WALLET_V2_ADDRESS_PLACEHOLDER,
    WALLET_V2_ADDRESS_REGEX,
    WALLET_V2_IS_TESTNET,
    WALLET_V2_NETWORK,
} from '@/lib/walletV2/network';

import styles from './page.module.css';

type OnboardingMode = 'create' | 'import';
type WalletDrawerMode = 'topup' | 'receive' | 'send' | null;
type SendStep = 'input' | 'confirm' | 'success';
type PinAuthFlow = 'none' | 'create_setup' | 'import_setup' | 'tx_confirm' | 'entry_auth';

type WalletV2BalanceRow = {
    asset: string;
    available: string;
    locked: string;
    updatedAt: string;
};

type WalletV2HistoryItem = {
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
};

type WalletV2HistoryGroup = {
    key: string;
    label: string;
    items: WalletV2HistoryItem[];
};

type WalletV2HistoryTab = 'feed' | 'nft';

type NftPartyInfo = {
    id: string;
    username: string | null;
    firstName: string | null;
    photoUrl: string | null;
};

type NftTransactionItem = {
    id: string;
    txHash: string;
    type: string;
    direction: 'in' | 'out';
    amount: number;
    asset: string;
    from: string | null;
    fromFriendly: string | null;
    fromUser: NftPartyInfo | null;
    to: string | null;
    toFriendly: string | null;
    toUser: NftPartyInfo | null;
    tokenId: string | null;
    modelName: string | null;
    serialNumber: string | null;
    collectionName: string | null;
    tgsUrl: string | null;
    status: string;
    timestamp: string;
    fee: string | null;
    memo: string | null;
};

type NftHistoryGroup = {
    key: string;
    label: string;
    items: NftTransactionItem[];
};

type NftTxDisplayKind = 'received' | 'sent' | 'minted' | 'burn';

type PendingSendChallenge = {
    txId: string;
    challengeId: string;
    toAddress: string;
    asset: string;
    amount: string;
    expiresAt: string;
    methods: string[];
};

const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 4;
const MNEMONIC_WORDS_COUNT = 24;
const MAX_AMOUNT_INPUT_DIGITS = 18;
const ASSET_REGEX = /^[A-Z0-9_]{2,16}$/;
const WALLET_V2_BALANCE_CACHE_PREFIX = 'wallet_v2_balance_cache:';

function isValidPin(pin: string): boolean {
    return /^[0-9]{4}$/.test(pin);
}

function parseMnemonicWords(value: string): string[] {
    return value
        .toLowerCase()
        .replace(/[\n\r\t,;]+/g, ' ')
        .split(' ')
        .map((word) => word.trim())
        .filter(Boolean);
}

function sanitizeWalletAddress(value: string): string {
    return sanitizeWalletV2AddressInput(value);
}

function sanitizeAsset(value: string): string {
    return value
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '')
        .slice(0, 16);
}

function normalizeAmountDigits(value: string): string {
    const digits = value.replace(/[^0-9]/g, '').slice(0, MAX_AMOUNT_INPUT_DIGITS);
    return digits.replace(/^0+(?=\d)/, '');
}

function formatAmountInput(value: string): string {
    const digits = normalizeAmountDigits(value);

    if (!digits) {
        return '';
    }

    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function normalizeIntegerString(value: string): string {
    const digitsOnly = value.replace(/[^0-9]/g, '');
    const normalized = digitsOnly.replace(/^0+(?=\d)/, '');
    return normalized || '0';
}

function parsePositiveIntegerString(value: string): string | null {
    if (!/^[0-9]+$/.test(value)) {
        return null;
    }

    const normalized = normalizeIntegerString(value);

    if (normalized === '0') {
        return null;
    }

    return normalized;
}

function compareIntegerStrings(leftRaw: string, rightRaw: string): number {
    const left = normalizeIntegerString(leftRaw);
    const right = normalizeIntegerString(rightRaw);

    if (left.length !== right.length) {
        return left.length > right.length ? 1 : -1;
    }

    if (left === right) {
        return 0;
    }

    return left > right ? 1 : -1;
}

function formatIntegerString(value: string): string {
    const normalized = value.trim().replace(/^0+(?=\d)/, '') || '0';
    return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function formatDateTime(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function localeToIntlCode(locale: string): string {
    if (locale === 'ru') return 'ru-RU';
    if (locale === 'uz') return 'uz-UZ';
    return 'en-US';
}

function toInputDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function dateKeyFromTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return 'invalid-date';
    }

    return toInputDate(date);
}

function formatGroupDate(dateKey: string, locale: string): string {
    const [yearRaw, monthRaw, dayRaw] = dateKey.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);

    if (!year || !month || !day) {
        return dateKey;
    }

    const date = new Date(year, month - 1, day);
    const currentYear = new Date().getFullYear();
    const includeYear = year !== currentYear;

    return new Intl.DateTimeFormat(localeToIntlCode(locale), {
        day: 'numeric',
        month: 'long',
        ...(includeYear ? { year: 'numeric' } : {}),
    }).format(date);
}

function formatHistoryDate(value: string, locale: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    const includeYear = date.getFullYear() !== new Date().getFullYear();

    return new Intl.DateTimeFormat(localeToIntlCode(locale), {
        day: 'numeric',
        month: 'short',
        ...(includeYear ? { year: 'numeric' } : {}),
    }).format(date);
}

function formatHistoryTime(value: string, locale: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }

    return new Intl.DateTimeFormat(localeToIntlCode(locale), {
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

type WalletV2BalanceCacheEntry = {
    address: string | null;
    balances: WalletV2BalanceRow[];
};

function readWalletV2BalanceCache(walletId: string | null): WalletV2BalanceCacheEntry | null {
    if (!walletId || typeof window === 'undefined') {
        return null;
    }

    try {
        const raw = localStorage.getItem(`${WALLET_V2_BALANCE_CACHE_PREFIX}${walletId}`);

        if (!raw) {
            return null;
        }

        const parsed = JSON.parse(raw) as {
            address?: unknown;
            balances?: unknown;
        };
        const cachedAddress = typeof parsed.address === 'string' && parsed.address.trim()
            ? parsed.address.trim()
            : null;
        const cachedBalances = Array.isArray(parsed.balances)
            ? parsed.balances
                .filter((row): row is WalletV2BalanceRow => {
                    if (!row || typeof row !== 'object') {
                        return false;
                    }

                    const candidate = row as Record<string, unknown>;
                    return (
                        typeof candidate.asset === 'string'
                        && typeof candidate.available === 'string'
                        && typeof candidate.locked === 'string'
                        && typeof candidate.updatedAt === 'string'
                    );
                })
                .map((row) => ({
                    asset: row.asset,
                    available: row.available,
                    locked: row.locked,
                    updatedAt: row.updatedAt,
                }))
            : [];

        if (!cachedAddress && cachedBalances.length === 0) {
            return null;
        }

        return {
            address: cachedAddress,
            balances: cachedBalances,
        };
    } catch {
        return null;
    }
}

function writeWalletV2BalanceCache(walletId: string | null, payload: WalletV2BalanceCacheEntry): void {
    if (!walletId || typeof window === 'undefined') {
        return;
    }

    try {
        localStorage.setItem(
            `${WALLET_V2_BALANCE_CACHE_PREFIX}${walletId}`,
            JSON.stringify(payload),
        );
    } catch {
        // Ignore localStorage quota/runtime errors.
    }
}

function isMintLikeType(type: string): boolean {
    const normalized = type.trim().toLowerCase();
    return normalized === 'mint' || normalized === 'minted' || normalized === 'activated';
}

function isBurnType(type: string): boolean {
    const normalized = type.trim().toLowerCase();
    return normalized === 'burn' || normalized === 'burned';
}

function resolveNftDisplayKind(item: Pick<NftTransactionItem, 'type' | 'direction'>): NftTxDisplayKind {
    if (isBurnType(item.type)) {
        return 'burn';
    }

    if (isMintLikeType(item.type)) {
        return 'minted';
    }

    return item.direction === 'in' ? 'received' : 'sent';
}

function safeErrorMessage(error: unknown): string {
    if (isWalletV2ApiError(error)) {
        if (error.code === 'INVALID_PIN') {
            const remainingAttempts = typeof error.details?.remainingAttempts === 'number'
                ? Math.max(0, Math.floor(error.details.remainingAttempts))
                : null;

            return remainingAttempts !== null
                ? `Invalid PIN. Attempts left: ${remainingAttempts}`
                : 'Invalid PIN';
        }

        if (error.code === 'WALLET_LIMIT_REACHED') {
            return 'Wallet limit reached. Up to 10 wallets per user are allowed.';
        }

        if (error.code === 'INVALID_MNEMONIC') {
            return 'Mnemonic is invalid. Check all 24 words and order.';
        }

        if (error.code === 'IMPORT_RATE_LIMITED') {
            const retryAfterSec = typeof error.details?.retryAfterSec === 'number'
                ? Math.max(1, Math.floor(error.details.retryAfterSec))
                : null;

            return retryAfterSec
                ? `Too many import attempts. Try again in ${retryAfterSec}s.`
                : 'Too many import attempts. Try again later.';
        }

        if (error.code === 'INVALID_ADDRESS') {
            return 'Recipient address format is invalid.';
        }

        if (error.code === 'INVALID_ASSET') {
            return 'Asset is invalid.';
        }

        if (error.code === 'INVALID_AMOUNT') {
            return 'Amount must be a positive integer.';
        }

        if (error.code === 'INSUFFICIENT_BALANCE') {
            return 'Insufficient available balance.';
        }

        if (error.code === 'RECIPIENT_NOT_FOUND') {
            return 'Recipient wallet not found.';
        }

        if (error.code === 'CHALLENGE_EXPIRED') {
            return 'Confirmation challenge expired. Create transaction again.';
        }

        if (error.code === 'INVALID_BIOMETRIC') {
            return 'Biometric confirmation failed. Use PIN fallback.';
        }

        if (error.code === 'PIN_ATTEMPTS_EXCEEDED') {
            return 'Too many failed PIN attempts. Transaction was canceled.';
        }

        if (error.code === 'SELF_REVOKE_NOT_ALLOWED') {
            return 'Use Logout to revoke current device session.';
        }

        if (error.code === 'SESSION_NOT_FOUND') {
            return 'Session not found or already revoked.';
        }

        if (error.code === 'SESSION_ID_REQUIRED') {
            return 'Session id is required.';
        }

        if (error.code === 'INVALID_REFRESH_TOKEN') {
            return 'Wallet session token is invalid. Import wallet again.';
        }

        if (error.code === 'SESSION_REVOKED') {
            return 'Wallet session is revoked or expired. Import wallet again.';
        }

        if (error.message) {
            return error.message;
        }
    }

    if (error instanceof Error && error.message) {
        return error.message;
    }

    return 'Request failed';
}

function maskAddress(value: string): string {
    const normalized = formatWalletV2Address(value.trim());

    if (normalized.length <= 8) {
        return normalized;
    }

    return `${normalized.slice(0, 7)}...${normalized.slice(-4)}`;
}

async function writeToClipboard(value: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
}

function createIdempotencyKey(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `wv2-${crypto.randomUUID()}`;
    }

    return `wv2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function WalletV2Page() {
    const { t, locale } = useLanguage();
    const { isAuthenticated, haptic, webApp } = useTelegram();
    const router = useRouter();
    const tr = useCallback((key: string, fallback: string): string => {
        const value = t(key as never);
        return value === key ? fallback : value;
    }, [t]);

    const [mode, setMode] = useState<OnboardingMode>('create');

    const [importMnemonicInput, setImportMnemonicInput] = useState('');

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [requestError, setRequestError] = useState('');
    const [requestSuccess, setRequestSuccess] = useState('');

    const [hasStoredPin, setHasStoredPin] = useState<boolean>(() => hasWalletV2StoredPin());
    const [walletId, setWalletId] = useState<string | null>(() => api.walletV2.session.getWalletId());
    const [walletAddress, setWalletAddress] = useState<string | null>(null);
    const [balances, setBalances] = useState<WalletV2BalanceRow[]>([]);
    const [isBalanceLoading, setIsBalanceLoading] = useState(false);
    const [balanceError, setBalanceError] = useState('');
    const [activeHistoryTab, setActiveHistoryTab] = useState<WalletV2HistoryTab>('feed');
    const [historyItems, setHistoryItems] = useState<WalletV2HistoryItem[]>([]);
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState('');
    const [nftTransactions, setNftTransactions] = useState<NftTransactionItem[]>([]);
    const [isNftLoading, setIsNftLoading] = useState(false);
    const [nftError, setNftError] = useState('');
    const [selectedNftTransaction, setSelectedNftTransaction] = useState<NftTransactionItem | null>(null);
    const [selectedWalletTransaction, setSelectedWalletTransaction] = useState<WalletV2HistoryItem | null>(null);

    const [mnemonicWords, setMnemonicWords] = useState<string[]>([]);
    const [isMnemonicDrawerOpen, setIsMnemonicDrawerOpen] = useState(false);
    const [isMnemonicCopied, setIsMnemonicCopied] = useState(false);

    const [walletDrawerMode, setWalletDrawerMode] = useState<WalletDrawerMode>(null);
    const [isDrawerSubmitting, setIsDrawerSubmitting] = useState(false);
    const [drawerError, setDrawerError] = useState('');

    const [receiveAddress, setReceiveAddress] = useState('');
    const [isReceiveCopied, setIsReceiveCopied] = useState(false);

    const [sendStep, setSendStep] = useState<SendStep>('input');
    const [sendAddressInput, setSendAddressInput] = useState('');
    const [sendAssetInput, setSendAssetInput] = useState('');
    const [sendAmountInput, setSendAmountInput] = useState('');
    const [testnetTopupAmountInput, setTestnetTopupAmountInput] = useState('');
    const [pendingSend, setPendingSend] = useState<PendingSendChallenge | null>(null);
    const [pinAuthFlow, setPinAuthFlow] = useState<PinAuthFlow>('none');
    const [pinAuthError, setPinAuthError] = useState('');
    const [hasInitialGateResolved, setHasInitialGateResolved] = useState(false);
    const [deviceBiometricSupported, setDeviceBiometricSupported] = useState(false);
    const [devicePubKey, setDevicePubKey] = useState<string | null>(null);
    const [isBiometricLoading, setIsBiometricLoading] = useState(false);
    const [isBiometricConfirmationEnabled, setIsBiometricConfirmationEnabled] = useState(true);
    const [isPinAuthBiometricLoading, setIsPinAuthBiometricLoading] = useState(false);

    const isPinAuthOpen = pinAuthFlow !== 'none';
    useBodyScrollLock(
        isMnemonicDrawerOpen
        || Boolean(walletDrawerMode)
        || isPinAuthOpen
        || Boolean(selectedNftTransaction)
        || Boolean(selectedWalletTransaction),
    );

    const devicePayload = useMemo(() => {
        return buildWalletV2DeviceInput(webApp?.platform, {
            biometricSupported: deviceBiometricSupported,
            devicePubKey: devicePubKey || null,
        });
    }, [deviceBiometricSupported, devicePubKey, webApp?.platform]);
    const biometricIconKind = useMemo(() => {
        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';

        return resolveWalletV2BiometricVisualType(webApp?.platform, {
            biometricType: webApp?.BiometricManager?.biometricType,
            userAgent,
        });
    }, [webApp?.BiometricManager?.biometricType, webApp?.platform]);

    const hasPinConfigured = hasStoredPin || Boolean(walletId);
    const isNewUser = !walletId && !hasPinConfigured;
    const parsedImportWords = useMemo(() => parseMnemonicWords(importMnemonicInput), [importMnemonicInput]);
    const mnemonicPhrase = useMemo(() => mnemonicWords.join(' '), [mnemonicWords]);
    const mnemonicColumns = useMemo(() => {
        return [
            mnemonicWords.slice(0, 12),
            mnemonicWords.slice(12, 24),
        ];
    }, [mnemonicWords]);
    const hasValidMnemonicCount = parsedImportWords.length === MNEMONIC_WORDS_COUNT;

    const canSubmitCreate = !isSubmitting;
    const canSubmitImport = hasValidMnemonicCount && !isSubmitting;

    const normalizedSendAddress = useMemo(() => sanitizeWalletAddress(sendAddressInput), [sendAddressInput]);
    const normalizedSendAsset = useMemo(() => sanitizeAsset(sendAssetInput || 'UZS'), [sendAssetInput]);
    const normalizedSendAmount = useMemo(() => normalizeAmountDigits(sendAmountInput), [sendAmountInput]);
    const parsedSendAmount = useMemo(() => parsePositiveIntegerString(normalizedSendAmount), [normalizedSendAmount]);
    const normalizedTestnetTopupAmount = useMemo(
        () => normalizeAmountDigits(testnetTopupAmountInput),
        [testnetTopupAmountInput],
    );
    const parsedTestnetTopupAmount = useMemo(
        () => parsePositiveIntegerString(normalizedTestnetTopupAmount),
        [normalizedTestnetTopupAmount],
    );
    const balanceMap = useMemo(() => {
        const map = new Map<string, string>();

        balances.forEach((balance) => {
            const parsed = parsePositiveIntegerString(balance.available) || '0';
            map.set(balance.asset, parsed);
        });

        return map;
    }, [balances]);
    const availableForSendAsset = useMemo(() => {
        return balanceMap.get(normalizedSendAsset) || '0';
    }, [balanceMap, normalizedSendAsset]);
    const primaryBalance = useMemo(() => {
        const uzs = balances.find((balance) => balance.asset === 'UZS');
        return uzs || balances[0] || null;
    }, [balances]);
    const canUsePendingBiometric = useMemo(() => {
        return Boolean(
            isBiometricConfirmationEnabled
            && pendingSend
            && pendingSend.methods.includes('biometric')
            && devicePayload.biometricSupported,
        );
    }, [devicePayload.biometricSupported, isBiometricConfirmationEnabled, pendingSend]);
    const canCreateSend = Boolean(
        walletId
        && WALLET_V2_ADDRESS_REGEX.test(normalizedSendAddress)
        && ASSET_REGEX.test(normalizedSendAsset)
        && parsedSendAmount
        && compareIntegerStrings(parsedSendAmount, availableForSendAsset) <= 0
        && !isDrawerSubmitting,
    );
    const canApplyTestnetTopup = Boolean(
        WALLET_V2_IS_TESTNET
        && walletId
        && parsedTestnetTopupAmount
        && !isDrawerSubmitting,
    );
    const pinAuthDetails = useMemo<PinAuthScreenDetail[]>(() => {
        if (!pendingSend) {
            return [];
        }

        return [
            {
                label: tr('wallet_send_to_short_label', 'To'),
                value: pendingSend.toAddress,
            },
            {
                label: tr('wallet_v2_asset', 'Asset'),
                value: pendingSend.asset,
            },
            {
                label: tr('wallet_amount_label', 'Amount'),
                value: formatIntegerString(pendingSend.amount),
            },
            {
                label: tr('wallet_v2_challenge_expires', 'Challenge expires'),
                value: formatDateTime(pendingSend.expiresAt),
            },
        ];
    }, [pendingSend, tr]);
    const primaryBalanceValue = useMemo(() => {
        if (!primaryBalance) {
            return null;
        }

        return formatIntegerString(primaryBalance.available);
    }, [primaryBalance]);
    const primaryBalanceAsset = primaryBalance?.asset || 'UZS';
    const isPrimaryBalancePlaceholderVisible = isBalanceLoading && !primaryBalance;
    const groupedHistory = useMemo<WalletV2HistoryGroup[]>(() => {
        const groupsMap = new Map<string, WalletV2HistoryItem[]>();

        historyItems.forEach((item) => {
            const key = dateKeyFromTimestamp(item.createdAt);
            const current = groupsMap.get(key);

            if (current) {
                current.push(item);
            } else {
                groupsMap.set(key, [item]);
            }
        });

        return Array.from(groupsMap.entries())
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([key, items]) => ({
                key,
                label: key === 'invalid-date'
                    ? (t('transactions_unknown_date') || 'Unknown date')
                    : formatGroupDate(key, locale),
                items,
            }));
    }, [historyItems, locale, t]);
    const groupedNftTransactions = useMemo<NftHistoryGroup[]>(() => {
        const grouped = new Map<string, NftTransactionItem[]>();

        nftTransactions.forEach((item) => {
            const key = dateKeyFromTimestamp(item.timestamp);
            const existing = grouped.get(key);
            if (existing) {
                existing.push(item);
            } else {
                grouped.set(key, [item]);
            }
        });

        return Array.from(grouped.entries())
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([key, items]) => ({
                key,
                label: key === 'invalid-date'
                    ? (t('transactions_unknown_date') || 'Unknown date')
                    : formatGroupDate(key, locale),
                items,
            }));
    }, [locale, nftTransactions, t]);

    const getOperationTitle = useCallback((type: WalletV2HistoryItem['type']) => {
        if (type === 'topup') {
            return t('wallet_history_operation_topup') || 'Top up';
        }

        if (type === 'send') {
            return t('wallet_history_operation_send') || 'Send';
        }

        if (type === 'receive') {
            return t('wallet_history_operation_receive') || 'Receive';
        }

        return type;
    }, [t]);

    const getStatusLabel = useCallback((status: string) => {
        const normalized = status.trim().toLowerCase();

        if (normalized === 'completed') {
            return t('wallet_history_status_completed') || 'Completed';
        }

        if (!normalized) {
            return t('wallet_history_status_completed') || 'Completed';
        }

        return status;
    }, [t]);

    const getNftDirectionLabel = useCallback((kind: NftTxDisplayKind) => {
        if (kind === 'burn') {
            return t('transactions_direction_burn') || t('burned') || 'BURNED';
        }

        if (kind === 'minted') {
            return t('transactions_direction_minted') || t('minted') || 'MINTED';
        }

        return kind === 'received'
            ? (t('transactions_direction_in') || 'RECEIVE')
            : (t('transactions_direction_out') || 'SEND');
    }, [t]);

    const getNftKindClassName = useCallback((kind: NftTxDisplayKind) => {
        if (kind === 'burn') {
            return styles.nftKindBurn;
        }

        if (kind === 'minted') {
            return styles.nftKindMinted;
        }

        if (kind === 'received') {
            return styles.nftKindReceived;
        }

        return styles.nftKindSent;
    }, []);

    const getNftKindIcon = useCallback((kind: NftTxDisplayKind, size = 18) => {
        if (kind === 'burn') {
            return <IoFlame size={size} />;
        }

        if (kind === 'minted') {
            return <IoSparkles size={size} />;
        }

        if (kind === 'received') {
            return <IoArrowDown size={size} />;
        }

        return <IoArrowUp size={size} />;
    }, []);

    const closeNftDetails = useCallback(() => {
        setSelectedNftTransaction(null);
    }, []);

    const handleNftCardClick = useCallback((item: NftTransactionItem) => {
        haptic.impact('light');
        setSelectedWalletTransaction(null);
        setSelectedNftTransaction(item);
    }, [haptic]);

    const closeWalletDetails = useCallback(() => {
        setSelectedWalletTransaction(null);
    }, []);

    const handleWalletCardClick = useCallback((item: WalletV2HistoryItem) => {
        haptic.impact('light');
        setSelectedNftTransaction(null);
        setSelectedWalletTransaction(item);
    }, [haptic]);

    const loadWalletBalance = useCallback(async (showLoader = true) => {
        if (!walletId) {
            setWalletAddress(null);
            setBalances([]);
            setBalanceError('');
            return;
        }

        if (showLoader) {
            setIsBalanceLoading(true);
        }

        setBalanceError('');

        try {
            const response = await api.walletV2.balance(walletId);
            const normalizedAddress = formatWalletV2Address(response.address);
            const normalizedBalances = response.balances || [];

            setWalletAddress(normalizedAddress);
            setBalances(normalizedBalances);
            setWalletId(response.walletId);
            writeWalletV2BalanceCache(response.walletId, {
                address: normalizedAddress,
                balances: normalizedBalances,
            });
        } catch (error) {
            setBalanceError(safeErrorMessage(error));
        } finally {
            if (showLoader) {
                setIsBalanceLoading(false);
            }
        }
    }, [walletId]);

    const loadWalletHistory = useCallback(async () => {
        if (!walletId) {
            setHistoryItems([]);
            setHistoryError('');
            setIsHistoryLoading(false);
            return;
        }

        setIsHistoryLoading(true);
        setHistoryError('');

        try {
            const response = await api.walletV2.transactions(walletId, { limit: 120 });
            setHistoryItems(response.items || []);
        } catch (error) {
            setHistoryItems([]);
            setHistoryError(safeErrorMessage(error));
        } finally {
            setIsHistoryLoading(false);
        }
    }, [walletId]);

    const loadNftTransactions = useCallback(async () => {
        if (!isAuthenticated) {
            setNftTransactions([]);
            setNftError(t('login_required') || 'Login required');
            setIsNftLoading(false);
            return;
        }

        setIsNftLoading(true);
        setNftError('');

        try {
            const response = await api.transactions.list({ limit: 200 });
            setNftTransactions(response.transactions || []);
        } catch (error) {
            setNftTransactions([]);
            setNftError(safeErrorMessage(error));
        } finally {
            setIsNftLoading(false);
        }
    }, [isAuthenticated, t]);

    useEffect(() => {
        const unsubscribe = api.walletV2.session.onRevoked(() => {
            setWalletId(null);
            setWalletAddress(null);
            setBalances([]);
            setHistoryItems([]);
            setHistoryError('');
            setNftTransactions([]);
            setNftError('');
            setSelectedNftTransaction(null);
            setSelectedWalletTransaction(null);
            setIsMnemonicDrawerOpen(false);
            setWalletDrawerMode(null);
            setPendingSend(null);
            setPinAuthFlow('none');
            setPinAuthError('');
            setRequestError(tr('wallet_v2_session_revoked_error', 'Wallet session was revoked. Authenticate and import wallet again.'));
        });

        return unsubscribe;
    }, [tr]);

    useEffect(() => {
        if (!walletId) {
            setBalances([]);
            setWalletAddress(null);
            setBalanceError('');
            setIsBalanceLoading(false);
            setHistoryItems([]);
            setHistoryError('');
            setIsHistoryLoading(false);
            setNftTransactions([]);
            setNftError('');
            setIsNftLoading(false);
            setSelectedNftTransaction(null);
            setSelectedWalletTransaction(null);
            return;
        }

        const cachedBalance = readWalletV2BalanceCache(walletId);
        if (cachedBalance) {
            setWalletAddress(cachedBalance.address ? formatWalletV2Address(cachedBalance.address) : null);
            setBalances(cachedBalance.balances);
        } else {
            setBalances([]);
        }

        void loadWalletBalance(true);
        void loadWalletHistory();
        void loadNftTransactions();
    }, [loadNftTransactions, loadWalletBalance, loadWalletHistory, walletId]);

    useEffect(() => {
        if (activeHistoryTab !== 'nft') {
            setSelectedNftTransaction(null);
        }
    }, [activeHistoryTab]);

    useEffect(() => {
        if (activeHistoryTab !== 'feed') {
            setSelectedWalletTransaction(null);
        }
    }, [activeHistoryTab]);

    useEffect(() => {
        if (!walletId) {
            setIsBiometricConfirmationEnabled(true);
            setMnemonicWords([]);
            return;
        }

        setIsBiometricConfirmationEnabled(getWalletV2BiometricConfirmationEnabled(walletId));
        setMnemonicWords(getWalletV2MnemonicWords(walletId));
    }, [walletId]);

    useEffect(() => {
        if (!walletId) {
            return;
        }

        if (!sendAssetInput) {
            if (primaryBalance?.asset) {
                setSendAssetInput(primaryBalance.asset);
            } else {
                setSendAssetInput('UZS');
            }
        }
    }, [primaryBalance?.asset, sendAssetInput, walletId]);

    useEffect(() => {
        let canceled = false;

        const loadBiometricSnapshot = async () => {
            if (!devicePayload.deviceId) {
                setDeviceBiometricSupported(false);
                setDevicePubKey(null);
                return;
            }

            setIsBiometricLoading(true);

            try {
                const snapshot = await getWalletV2BiometricSnapshot(webApp, devicePayload.deviceId);

                if (canceled) {
                    return;
                }

                const biometricSupported = Boolean(
                    snapshot.managerAvailable
                    && snapshot.biometricAvailable
                    && snapshot.accessGranted
                    && snapshot.tokenSaved
                    && snapshot.devicePubKey,
                );

                setDeviceBiometricSupported(biometricSupported);
                setDevicePubKey(snapshot.devicePubKey);
            } finally {
                if (!canceled) {
                    setIsBiometricLoading(false);
                }
            }
        };

        void loadBiometricSnapshot();

        return () => {
            canceled = true;
        };
    }, [devicePayload.deviceId, webApp]);

    useEffect(() => {
        if (hasInitialGateResolved || !isAuthenticated || pinAuthFlow !== 'none' || isSubmitting || isDrawerSubmitting) {
            return;
        }

        if (walletId) {
            const rememberedAuthValid = isWalletV2RememberedAuthValid(walletId);

            if (!rememberedAuthValid) {
                setPinAuthError('');
                setPinAuthFlow('entry_auth');
            }
            setHasInitialGateResolved(true);
            return;
        }

        if (isNewUser) {
            setPinAuthError('');
            setPinAuthFlow('create_setup');
            setHasInitialGateResolved(true);
            return;
        }

        setHasInitialGateResolved(true);
    }, [
        hasInitialGateResolved,
        isAuthenticated,
        isDrawerSubmitting,
        isNewUser,
        isSubmitting,
        pinAuthFlow,
        walletId,
    ]);

    const clearImportForm = useCallback(() => {
        setImportMnemonicInput('');
    }, []);

    const closeMnemonicDrawer = useCallback(() => {
        setIsMnemonicDrawerOpen(false);
        setIsMnemonicCopied(false);
    }, []);

    const resetSendForm = useCallback(() => {
        setSendStep('input');
        setSendAddressInput('');
        setSendAmountInput('');
        setPendingSend(null);
        setPinAuthFlow('none');
        setPinAuthError('');
        setDrawerError('');
    }, []);

    const closeWalletDrawer = useCallback(() => {
        setWalletDrawerMode(null);
        setIsDrawerSubmitting(false);
        setDrawerError('');
        setIsReceiveCopied(false);
        setTestnetTopupAmountInput('');
        resetSendForm();
    }, [resetSendForm]);

    const resolveDevicePayloadForWalletMutation = useCallback(async (reason: string) => {
        const walletDeviceId = devicePayload.deviceId;

        if (!walletDeviceId) {
            return buildWalletV2DeviceInput(webApp?.platform, {
                biometricSupported: deviceBiometricSupported,
                devicePubKey,
            });
        }

        setIsBiometricLoading(true);

        try {
            const result = await enableWalletV2Biometric({
                webApp,
                walletDeviceId,
                reason,
            });

            setDeviceBiometricSupported(result.biometricSupported);
            setDevicePubKey(result.devicePubKey);

            return buildWalletV2DeviceInput(webApp?.platform, {
                biometricSupported: result.biometricSupported,
                devicePubKey: result.devicePubKey,
            });
        } catch {
            return buildWalletV2DeviceInput(webApp?.platform, {
                biometricSupported: deviceBiometricSupported,
                devicePubKey,
            });
        } finally {
            setIsBiometricLoading(false);
        }
    }, [deviceBiometricSupported, devicePayload.deviceId, devicePubKey, webApp]);

    const clearPinAuthError = useCallback(() => {
        setPinAuthError('');
    }, []);

    const handleOpenCreatePinSetup = useCallback(() => {
        if (!isAuthenticated) {
            setRequestError(t('login_required') || 'Login required');
            haptic.error();
            return;
        }

        setRequestError('');
        setRequestSuccess('');
        setPinAuthError('');
        setPinAuthFlow('create_setup');
        haptic.impact('light');
    }, [haptic, isAuthenticated, t]);

    const handleOpenImportPinSetup = useCallback(() => {
        if (!isAuthenticated) {
            setRequestError(t('login_required') || 'Login required');
            haptic.error();
            return;
        }

        if (!hasValidMnemonicCount) {
            setRequestError(tr('wallet_v2_error_mnemonic_count', 'Enter exactly 24 mnemonic words'));
            haptic.error();
            return;
        }

        setRequestError('');
        setRequestSuccess('');
        setPinAuthError('');
        setPinAuthFlow('import_setup');
        haptic.impact('light');
    }, [haptic, hasValidMnemonicCount, isAuthenticated, t, tr]);

    const handleCreateWallet = useCallback(async (pin: string) => {
        if (!isAuthenticated) {
            setRequestError(t('login_required') || 'Login required');
            return;
        }

        if (!isValidPin(pin)) {
            setPinAuthError(tr('wallet_v2_error_pin_length', 'PIN must contain 4 digits'));
            haptic.error();
            return;
        }

        setIsSubmitting(true);
        setRequestError('');
        setRequestSuccess('');
        setPinAuthError('');

        try {
            const nextDevicePayload = await resolveDevicePayloadForWalletMutation(
                'Enable biometric confirmation for wallet transfers',
            );
            const response = await api.walletV2.create({
                pin,
                device: nextDevicePayload,
            });

            setWalletV2BiometricConfirmationEnabled(response.wallet.id, true);
            setWalletV2MnemonicWords(response.wallet.id, response.mnemonic || []);
            setWalletV2StoredPinConfigured(true);
            markWalletV2RememberedAuth(response.wallet.id);

            setWalletId(response.wallet.id);
            setHasStoredPin(true);
            setWalletAddress(response.wallet.address ? formatWalletV2Address(response.wallet.address) : null);
            setMnemonicWords(response.mnemonic || []);
            setIsBiometricConfirmationEnabled(true);
            setIsMnemonicCopied(false);
            setIsMnemonicDrawerOpen(true);
            setPinAuthFlow('none');
            setRequestSuccess(tr('wallet_v2_create_success', 'Wallet created. Save your 24 recovery words now.'));
            haptic.success();
        } catch (error) {
            const message = safeErrorMessage(error);
            setPinAuthError(message);
            setRequestError(message);
            haptic.error();
        } finally {
            setIsSubmitting(false);
        }
    }, [
        haptic,
        isAuthenticated,
        resolveDevicePayloadForWalletMutation,
        t,
        tr,
    ]);

    const handleImportWallet = useCallback(async (newPin: string) => {
        if (!isAuthenticated) {
            setRequestError(t('login_required') || 'Login required');
            return;
        }

        if (!hasValidMnemonicCount) {
            setRequestError(tr('wallet_v2_error_mnemonic_count', 'Enter exactly 24 mnemonic words'));
            haptic.error();
            return;
        }

        if (!isValidPin(newPin)) {
            setPinAuthError(tr('wallet_v2_error_new_pin_length', 'New PIN must contain 4 digits'));
            haptic.error();
            return;
        }

        setIsSubmitting(true);
        setRequestError('');
        setRequestSuccess('');
        setPinAuthError('');

        try {
            const nextDevicePayload = await resolveDevicePayloadForWalletMutation(
                'Enable biometric confirmation for wallet transfers',
            );
            const response = await api.walletV2.import({
                mnemonic: parsedImportWords,
                newPin,
                device: nextDevicePayload,
            });

            setWalletV2BiometricConfirmationEnabled(response.wallet.id, true);
            setWalletV2MnemonicWords(response.wallet.id, parsedImportWords);
            setWalletV2StoredPinConfigured(true);
            markWalletV2RememberedAuth(response.wallet.id);

            setWalletId(response.wallet.id);
            setHasStoredPin(true);
            setWalletAddress(response.wallet.address ? formatWalletV2Address(response.wallet.address) : null);
            setMnemonicWords(parsedImportWords);
            setIsBiometricConfirmationEnabled(true);
            setPinAuthFlow('none');
            setRequestSuccess(tr('wallet_v2_import_success', 'Wallet imported. PIN has been updated for this device.'));
            clearImportForm();
            haptic.success();
        } catch (error) {
            const message = safeErrorMessage(error);
            setPinAuthError(message);
            setRequestError(message);
            haptic.error();
        } finally {
            setIsSubmitting(false);
        }
    }, [
        clearImportForm,
        hasValidMnemonicCount,
        haptic,
        isAuthenticated,
        parsedImportWords,
        resolveDevicePayloadForWalletMutation,
        t,
        tr,
    ]);

    const handlePinSetupComplete = useCallback(async (pin: string) => {
        if (pinAuthFlow === 'create_setup') {
            await handleCreateWallet(pin);
            return;
        }

        if (pinAuthFlow === 'import_setup') {
            await handleImportWallet(pin);
        }
    }, [handleCreateWallet, handleImportWallet, pinAuthFlow]);

    const completeEntryAuth = useCallback(() => {
        if (!walletId) {
            return;
        }

        markWalletV2RememberedAuth(walletId);
        setWalletV2StoredPinConfigured(true);
        setHasStoredPin(true);
        setPinAuthError('');
        setPinAuthFlow('none');
    }, [walletId]);

    const handleEntryAuthWithPin = useCallback(async (pin: string) => {
        if (!walletId) {
            const message = tr('wallet_v2_error_session_missing', 'Wallet session is missing');
            setPinAuthError(message);
            setRequestError(message);
            return;
        }

        if (!isValidPin(pin)) {
            const message = tr('wallet_v2_error_pin_length', 'PIN must contain 4 digits');
            setPinAuthError(message);
            haptic.error();
            return;
        }

        setIsSubmitting(true);
        setPinAuthError('');
        setRequestError('');

        try {
            await api.walletV2.verifyPin({
                walletId,
                pin,
            });
            completeEntryAuth();
            haptic.success();
        } catch (error) {
            const message = safeErrorMessage(error);
            setPinAuthError(message);
            setRequestError(message);
            haptic.error();
        } finally {
            setIsSubmitting(false);
        }
    }, [completeEntryAuth, haptic, tr, walletId]);

    const handleEntryAuthWithBiometric = useCallback(async () => {
        setIsPinAuthBiometricLoading(true);
        setPinAuthError('');

        try {
            const biometric = await authenticateWalletV2WithBiometric({
                webApp,
                reason: 'Unlock wallet',
            });

            if (!biometric.authenticated) {
                haptic.warning();
                return;
            }

            completeEntryAuth();
            haptic.success();
        } catch (error) {
            const message = safeErrorMessage(error);
            setPinAuthError(message);
            haptic.error();
        } finally {
            setIsPinAuthBiometricLoading(false);
        }
    }, [completeEntryAuth, haptic, webApp]);

    const handleCopyMnemonic = useCallback(async () => {
        if (!mnemonicPhrase) {
            return;
        }

        try {
            await writeToClipboard(mnemonicPhrase);
            setIsMnemonicCopied(true);
            haptic.success();
            window.setTimeout(() => {
                setIsMnemonicCopied(false);
            }, 1500);
        } catch {
            haptic.error();
        }
    }, [haptic, mnemonicPhrase]);

    const handleOpenReceive = useCallback(async () => {
        if (!walletId) {
            return;
        }

        setWalletDrawerMode('receive');
        setDrawerError('');
        setIsReceiveCopied(false);
        setIsDrawerSubmitting(true);

        try {
            const response = await api.walletV2.receive(walletId);
            const normalizedAddress = formatWalletV2Address(response.address);
            setReceiveAddress(normalizedAddress);
            setWalletAddress(normalizedAddress);
            haptic.selection();
        } catch (error) {
            setDrawerError(safeErrorMessage(error));
            haptic.error();
        } finally {
            setIsDrawerSubmitting(false);
        }
    }, [haptic, walletId]);

    const handleCopyReceiveAddress = useCallback(async () => {
        const value = receiveAddress || walletAddress || '';

        if (!value) {
            return;
        }

        try {
            await writeToClipboard(value);
            setIsReceiveCopied(true);
            haptic.success();
            window.setTimeout(() => {
                setIsReceiveCopied(false);
            }, 1500);
        } catch {
            haptic.error();
        }
    }, [haptic, receiveAddress, walletAddress]);

    const handleOpenSend = useCallback(() => {
        if (!walletId) {
            return;
        }

        setWalletDrawerMode('send');
        resetSendForm();
        setRequestError('');
        setRequestSuccess('');
        setPinAuthError('');
        haptic.selection();
    }, [haptic, resetSendForm, walletId]);

    const handleOpenTestnetTopup = useCallback(() => {
        if (!walletId || !WALLET_V2_IS_TESTNET) {
            return;
        }

        setWalletDrawerMode('topup');
        setDrawerError('');
        setRequestError('');
        setRequestSuccess('');
        setPinAuthError('');
        setTestnetTopupAmountInput('10 000');
        haptic.selection();
    }, [haptic, walletId]);

    const handleApplyTestnetTopup = useCallback(async () => {
        if (!walletId) {
            setDrawerError(tr('wallet_v2_error_session_missing', 'Wallet session is missing'));
            return;
        }

        if (!WALLET_V2_IS_TESTNET) {
            setDrawerError(tr('wallet_v2_error_testnet_only', 'Test top up is available only in testnet mode'));
            haptic.error();
            return;
        }

        if (!parsedTestnetTopupAmount) {
            setDrawerError(tr('wallet_v2_amount_invalid', 'Amount must be a positive integer'));
            haptic.error();
            return;
        }

        setIsDrawerSubmitting(true);
        setDrawerError('');

        try {
            await api.walletV2.testnetTopup({
                walletId,
                amount: parsedTestnetTopupAmount,
                asset: 'UZS',
            });
            await loadWalletBalance(false);
            await loadWalletHistory();
            setRequestError('');
            setRequestSuccess(tr('wallet_v2_testnet_topup_success', 'Testnet balance topped up.'));
            haptic.success();
            closeWalletDrawer();
        } catch (error) {
            setDrawerError(safeErrorMessage(error));
            haptic.error();
        } finally {
            setIsDrawerSubmitting(false);
        }
    }, [
        closeWalletDrawer,
        haptic,
        loadWalletBalance,
        loadWalletHistory,
        parsedTestnetTopupAmount,
        tr,
        walletId,
    ]);

    const handleCreateSend = useCallback(async () => {
        if (!walletId) {
            setDrawerError(tr('wallet_v2_error_session_missing', 'Wallet session is missing'));
            return;
        }

        if (!WALLET_V2_ADDRESS_REGEX.test(normalizedSendAddress)) {
            setDrawerError(
                tr(
                    'wallet_v2_error_invalid_address',
                    `Recipient address must match ${WALLET_V2_ADDRESS_PLACEHOLDER} format`,
                ),
            );
            haptic.error();
            return;
        }

        if (!ASSET_REGEX.test(normalizedSendAsset)) {
            setDrawerError(tr('wallet_v2_error_invalid_asset', 'Asset must contain 2-16 latin uppercase letters, digits or underscore'));
            haptic.error();
            return;
        }

        if (!parsedSendAmount) {
            setDrawerError(tr('wallet_v2_amount_invalid', 'Amount must be a positive integer'));
            haptic.error();
            return;
        }

        if (compareIntegerStrings(parsedSendAmount, availableForSendAsset) > 0) {
            setDrawerError(tr('wallet_v2_insufficient_asset_balance', 'Insufficient available balance for selected asset'));
            haptic.error();
            return;
        }

        setIsDrawerSubmitting(true);
        setDrawerError('');

        try {
            const response = await api.walletV2.sendCreate({
                walletId,
                toAddress: normalizedSendAddress,
                asset: normalizedSendAsset,
                amount: normalizedSendAmount,
                idempotencyKey: createIdempotencyKey(),
            });
            const challengeMethods = Array.isArray(response.challenge.methods)
                ? response.challenge.methods
                    .map((method) => String(method).trim().toLowerCase())
                    .filter(Boolean)
                : [];

            setPendingSend({
                txId: response.tx.id,
                challengeId: response.challenge.challengeId,
                toAddress: formatWalletV2Address(response.tx.toAddress),
                asset: response.tx.asset,
                amount: response.tx.amount,
                expiresAt: response.challenge.expiresAt,
                methods: challengeMethods,
            });
            setSendStep('confirm');
            setPinAuthError('');
            setPinAuthFlow('tx_confirm');
            haptic.success();
        } catch (error) {
            setDrawerError(safeErrorMessage(error));
            haptic.error();
        } finally {
            setIsDrawerSubmitting(false);
        }
    }, [
        availableForSendAsset,
        haptic,
        normalizedSendAddress,
        normalizedSendAmount,
        normalizedSendAsset,
        parsedSendAmount,
        tr,
        walletId,
    ]);

    const handleConfirmSend = useCallback(async (auth: { method: 'pin'; pin: string } | { method: 'biometric' }) => {
        if (!pendingSend) {
            const message = tr('wallet_v2_error_no_challenge', 'No active transaction challenge');
            setDrawerError(message);
            setPinAuthError(message);
            return;
        }

        if (auth.method === 'pin' && !isValidPin(auth.pin)) {
            const message = tr('wallet_v2_error_pin_length', 'PIN must contain 4 digits');
            setDrawerError(message);
            setPinAuthError(message);
            haptic.error();
            return;
        }

        setIsDrawerSubmitting(true);
        setIsPinAuthBiometricLoading(auth.method === 'biometric');
        setDrawerError('');
        setPinAuthError('');

        try {
            const response = auth.method === 'biometric'
                ? await (async () => {
                    const biometric = await signWalletV2ChallengeWithBiometric({
                        webApp,
                        txId: pendingSend.txId,
                        challengeId: pendingSend.challengeId,
                        reason: 'Confirm wallet transfer',
                    });

                    if (!biometric.signature) {
                        haptic.warning();
                        return null;
                    }

                    return api.walletV2.sendConfirm({
                        txId: pendingSend.txId,
                        challengeId: pendingSend.challengeId,
                        auth: {
                            method: 'biometric',
                            deviceId: devicePayload.deviceId,
                            signature: biometric.signature,
                        },
                    });
                })()
                : await api.walletV2.sendConfirm({
                    txId: pendingSend.txId,
                    challengeId: pendingSend.challengeId,
                    auth: {
                        method: 'pin',
                        pin: auth.pin,
                    },
                });

            if (!response) {
                return;
            }

            if (response.tx.status === 'completed') {
                setSendStep('success');
                setPinAuthFlow('none');
                setPinAuthError('');
                setRequestSuccess(tr('wallet_v2_transfer_success', 'Transfer completed successfully.'));
                setRequestError('');
                haptic.success();
                await loadWalletBalance(false);
                await loadWalletHistory();

                window.setTimeout(() => {
                    closeWalletDrawer();
                }, 900);
            } else {
                const message = `Unexpected tx status: ${response.tx.status}`;
                setDrawerError(message);
                setPinAuthError(message);
            }
        } catch (error) {
            const message = safeErrorMessage(error);
            setDrawerError(message);
            setPinAuthError(message);

            if (isWalletV2ApiError(error) && (
                error.code === 'PIN_ATTEMPTS_EXCEEDED'
                || error.code === 'CHALLENGE_EXPIRED'
                || error.code === 'CHALLENGE_INACTIVE'
                || error.code === 'TX_NOT_PENDING'
            )) {
                setPinAuthFlow('none');
                setSendStep('input');
                setPendingSend(null);
            }

            haptic.error();
        } finally {
            setIsPinAuthBiometricLoading(false);
            setIsDrawerSubmitting(false);
        }
    }, [
        closeWalletDrawer,
        devicePayload.deviceId,
        haptic,
        loadWalletBalance,
        loadWalletHistory,
        pendingSend,
        tr,
        webApp,
    ]);

    const handleConfirmSendWithPin = useCallback(async (pin: string) => {
        await handleConfirmSend({ method: 'pin', pin });
    }, [handleConfirmSend]);

    const handleConfirmSendWithBiometric = useCallback(async () => {
        await handleConfirmSend({ method: 'biometric' });
    }, [handleConfirmSend]);

    const handlePinAuthConfirm = useCallback(async (pin: string) => {
        if (pinAuthFlow === 'entry_auth') {
            await handleEntryAuthWithPin(pin);
            return;
        }

        await handleConfirmSendWithPin(pin);
    }, [handleConfirmSendWithPin, handleEntryAuthWithPin, pinAuthFlow]);

    const handlePinAuthBiometric = useCallback(async () => {
        if (pinAuthFlow === 'entry_auth') {
            await handleEntryAuthWithBiometric();
            return;
        }

        await handleConfirmSendWithBiometric();
    }, [handleConfirmSendWithBiometric, handleEntryAuthWithBiometric, pinAuthFlow]);

    const handleSendDrawerClose = useCallback(() => {
        if (sendStep === 'confirm' && pendingSend) {
            return;
        }

        closeWalletDrawer();
    }, [closeWalletDrawer, pendingSend, sendStep]);

    const selectedNftKind = selectedNftTransaction ? resolveNftDisplayKind(selectedNftTransaction) : null;
    const selectedNftTitle = selectedNftTransaction?.collectionName
        || selectedNftTransaction?.modelName
        || (t('transactions_asset_nft') || 'NFT');
    const selectedNftSerial = selectedNftTransaction?.serialNumber ? `#${selectedNftTransaction.serialNumber}` : '';
    const selectedNftDateLabel = selectedNftTransaction ? formatHistoryDate(selectedNftTransaction.timestamp, locale) : '—';
    const selectedNftTimeLabel = selectedNftTransaction ? formatHistoryTime(selectedNftTransaction.timestamp, locale) : '—';
    const selectedNftAddress = useMemo(() => {
        if (!selectedNftTransaction || !selectedNftKind) {
            return null;
        }

        if (selectedNftKind === 'sent') {
            return selectedNftTransaction.toFriendly || selectedNftTransaction.to;
        }

        if (selectedNftKind === 'received') {
            return selectedNftTransaction.fromFriendly || selectedNftTransaction.from;
        }

        if (selectedNftKind === 'burn') {
            return selectedNftTransaction.toFriendly || selectedNftTransaction.to;
        }

        return selectedNftTransaction.fromFriendly || selectedNftTransaction.from;
    }, [selectedNftKind, selectedNftTransaction]);
    const selectedNftLowerTableLabel = useMemo(() => {
        if (!selectedNftKind) {
            return '';
        }

        if (selectedNftKind === 'sent') {
            return t('transactions_recipient') || 'Recipient';
        }

        if (selectedNftKind === 'received') {
            return t('transactions_sender') || 'Sender';
        }

        if (selectedNftKind === 'burn') {
            return t('transactions_burn_address') || 'Burn address';
        }

        return t('transactions_source') || 'Source';
    }, [selectedNftKind, t]);
    const selectedNftAddressValue = selectedNftAddress
        ? formatWalletShortLabel(selectedNftAddress)
        : (t('system') || 'System');
    const selectedNftMemo = (selectedNftTransaction?.memo || '').trim();
    const shouldShowNftMemoDetails = selectedNftMemo.length > 0;
    const selectedNftFeeValue = (selectedNftTransaction?.fee || '').trim();
    const shouldShowNftFeeDetails = selectedNftFeeValue.length > 0;
    const selectedNftNameLine = `${selectedNftTitle}${selectedNftSerial ? ` ${selectedNftSerial}` : ''}`;
    const selectedNftDateTimeLine = `${selectedNftDateLabel}, ${selectedNftTimeLabel}`;
    const selectedNftIcon = selectedNftKind ? getNftKindIcon(selectedNftKind) : <IoArrowUp size={18} />;

    const ownWalletLabel = formatWalletShortLabel(walletAddress);
    const selectedWalletDirectionLabel = selectedWalletTransaction
        ? getOperationTitle(selectedWalletTransaction.type)
        : '—';
    const selectedWalletIsIncoming = selectedWalletTransaction
        ? selectedWalletTransaction.direction === 'in'
            || selectedWalletTransaction.type === 'topup'
            || selectedWalletTransaction.type === 'receive'
        : false;
    const selectedWalletKindClass = selectedWalletIsIncoming ? styles.kindReceived : styles.kindSent;
    const selectedWalletIcon = selectedWalletIsIncoming
        ? <IoArrowDown size={22} />
        : <IoArrowUp size={22} />;
    const selectedWalletDateLabel = selectedWalletTransaction
        ? formatHistoryDate(selectedWalletTransaction.createdAt, locale)
        : '—';
    const selectedWalletTimeLabel = selectedWalletTransaction
        ? formatHistoryTime(selectedWalletTransaction.createdAt, locale)
        : '—';
    const selectedWalletDateTimeLine = `${selectedWalletDateLabel}, ${selectedWalletTimeLabel}`;
    const selectedWalletIsTopup = selectedWalletTransaction?.type === 'topup';
    const selectedWalletStatus = selectedWalletTransaction
        ? getStatusLabel(selectedWalletTransaction.status)
        : '—';
    const selectedWalletSenderRaw = selectedWalletTransaction?.fromAddress || null;
    const selectedWalletRecipientRaw = selectedWalletTransaction?.toAddress || null;
    const selectedWalletSenderValue = selectedWalletIsTopup
        ? (t('system') || 'System')
        : selectedWalletSenderRaw
            ? formatWalletShortLabel(selectedWalletSenderRaw)
            : (
                selectedWalletTransaction?.type === 'send'
                    ? ownWalletLabel
                    : (t('system') || 'System')
            );
    const selectedWalletRecipientValue = selectedWalletRecipientRaw
        ? formatWalletShortLabel(selectedWalletRecipientRaw)
        : (
            selectedWalletTransaction?.type === 'receive' || selectedWalletTransaction?.type === 'topup'
                ? ownWalletLabel
                : (t('system') || 'System')
        );
    const selectedWalletAmountValue = selectedWalletTransaction
        ? `${formatIntegerString(selectedWalletTransaction.amount)} ${selectedWalletTransaction.asset || 'UZS'}`
        : '—';
    const selectedWalletAsset = selectedWalletTransaction?.asset || 'UZS';
    const shouldShowWalletStatus = !selectedWalletIsTopup;

    const isPinSetupFlow = pinAuthFlow === 'create_setup' || pinAuthFlow === 'import_setup';
    const isTxConfirmFlow = pinAuthFlow === 'tx_confirm' && Boolean(pendingSend);
    const isEntryAuthFlow = pinAuthFlow === 'entry_auth';
    const canUseEntryBiometric = Boolean(
        isEntryAuthFlow
        && isBiometricConfirmationEnabled
        && devicePayload.biometricSupported,
    );
    const pinAuthSubtitle = pinAuthFlow === 'create_setup'
        ? tr('wallet_v2_pin_setup_create_subtitle', 'PIN setup happens before wallet generation.')
        : pinAuthFlow === 'import_setup'
            ? tr('wallet_v2_pin_setup_import_subtitle', 'Set a new PIN for this imported wallet.')
            : pinAuthFlow === 'entry_auth'
                ? tr('wallet_v2_unlock_subtitle', 'Use biometric or PIN to continue.')
                : tr('wallet_v2_pin_confirm_subtitle', 'Authorize transfer using biometric or PIN.');

    const isMainView = Boolean(walletId);

    return (
        <>
            <TelegramBackButton href="/profile" />

            <div className={styles.container}>
                <main className={styles.main}>
                    {isMainView ? (
                        <>
                            <section className={`${styles.card} ${styles.balanceCard}`}>
                                <div className={styles.balanceHeaderRow}>
                                    <div className={styles.balanceBadge}>
                                        <IoWallet size={16} />
                                        <span>{tr('wallet_balance_label', 'Balance')}</span>
                                        <span className={styles.networkPill}>
                                            {WALLET_V2_IS_TESTNET
                                                ? tr('wallet_v2_network_testnet', 'Testnet')
                                                : tr('wallet_v2_network_mainnet', 'Mainnet')}
                                        </span>
                                    </div>

                                    <button
                                        type="button"
                                        className={styles.refreshButton}
                                        onClick={() => {
                                            void loadWalletBalance(true);
                                            void loadWalletHistory();
                                            if (activeHistoryTab === 'nft') {
                                                void loadNftTransactions();
                                            }
                                        }}
                                        disabled={isBalanceLoading}
                                        aria-label={tr('wallet_v2_refresh', 'Refresh')}
                                    >
                                        <IoRefresh size={18} className={isBalanceLoading ? styles.refreshSpinning : ''} />
                                    </button>
                                </div>

                                <div className={styles.balanceTopRow}>
                                    <div className={styles.balanceValueWrap}>
                                        {isPrimaryBalancePlaceholderVisible ? (
                                            <span className={styles.balanceValueSkeleton} aria-hidden="true" />
                                        ) : (
                                            <strong className={styles.balanceValue}>{primaryBalanceValue || '0'}</strong>
                                        )}
                                        <span className={styles.balanceCurrency}>{primaryBalanceAsset}</span>
                                    </div>
                                </div>

                                <div className={styles.actionRow}>
                                    <button
                                        type="button"
                                        className={styles.actionTile}
                                        onClick={handleOpenTestnetTopup}
                                        disabled={!WALLET_V2_IS_TESTNET || !walletId}
                                    >
                                        <RoundIconButton as="span" size={50} className={`${styles.actionIcon} ${styles.actionIconTopup}`}>
                                            <IoWallet size={20} />
                                        </RoundIconButton>
                                        <span className={styles.actionLabel}>{tr('wallet_topup', 'Top up')}</span>
                                    </button>

                                    <button
                                        type="button"
                                        className={styles.actionTile}
                                        onClick={() => {
                                            void handleOpenReceive();
                                        }}
                                        disabled={!walletId}
                                    >
                                        <RoundIconButton as="span" size={50} className={`${styles.actionIcon} ${styles.actionIconReceive}`}>
                                            <IoArrowDown size={20} />
                                        </RoundIconButton>
                                        <span className={styles.actionLabel}>{tr('wallet_receive', 'Receive')}</span>
                                    </button>

                                    <button
                                        type="button"
                                        className={styles.actionTile}
                                        onClick={handleOpenSend}
                                        disabled={!walletId}
                                    >
                                        <RoundIconButton as="span" size={50} className={`${styles.actionIcon} ${styles.actionIconSend}`}>
                                            <IoArrowUp size={20} />
                                        </RoundIconButton>
                                        <span className={styles.actionLabel}>{tr('wallet_send', 'Send')}</span>
                                    </button>

                                    <button
                                        type="button"
                                        className={styles.actionTile}
                                        onClick={() => {
                                            haptic.impact('light');
                                            router.push('/wallet-v2/settings');
                                        }}
                                    >
                                        <RoundIconButton as="span" size={50} className={`${styles.actionIcon} ${styles.actionIconSettings}`}>
                                            <IoSettings size={20} />
                                        </RoundIconButton>
                                        <span className={styles.actionLabel}>{tr('settings', 'Settings')}</span>
                                    </button>
                                </div>
                            </section>

                            <SegmentedTabs
                                ariaLabel={t('wallet_history_title') || 'History'}
                                className={styles.historyTabs}
                                tabClassName={styles.historyTab}
                                activeTabClassName={styles.historyTabActive}
                                items={[
                                    { key: 'feed' as const, label: t('wallet_feed_tab') || 'Feed' },
                                    { key: 'nft' as const, label: t('wallet_nft_tab') || 'NFT' },
                                ]}
                                activeKey={activeHistoryTab}
                                onChange={(nextTab) => {
                                    setActiveHistoryTab(nextTab);
                                    haptic.selection();
                                }}
                            />

                            <section className={styles.historySection}>
                                {activeHistoryTab === 'feed' ? (
                                    <>
                                        {isHistoryLoading && (
                                            <WalletPageSkeleton variant="feed" groupCount={2} cardsPerGroup={3} />
                                        )}

                                        {!isHistoryLoading && historyError && (
                                            <div className={styles.errorState}>{historyError}</div>
                                        )}

                                        {!isHistoryLoading && !historyError && groupedHistory.length === 0 && (
                                            <div className={styles.emptyState}>
                                                {tr('wallet_history_empty', 'There are currently no wallet operations')}
                                            </div>
                                        )}

                                        {!isHistoryLoading && !historyError && groupedHistory.length > 0 && (
                                            <div className={styles.groupList}>
                                                {groupedHistory.map((group) => (
                                                    <div key={group.key} className={styles.groupSection}>
                                                        <h3 className={styles.groupTitle}>{group.label}</h3>
                                                        <div className={styles.cards}>
                                                            {group.items.map((item) => {
                                                                const isIncoming = item.direction === 'in'
                                                                    || item.type === 'topup'
                                                                    || item.type === 'receive';
                                                                const kindClass = isIncoming ? styles.kindReceived : styles.kindSent;
                                                                const dateTimeLine = `${formatHistoryDate(item.createdAt, locale)}, ${formatHistoryTime(item.createdAt, locale)}`;
                                                                const amountLine = `${isIncoming ? '+' : '-'}${formatIntegerString(item.amount)} ${item.asset || 'UZS'}`;

                                                                return (
                                                                    <TxCard
                                                                        key={item.id}
                                                                        className={styles.cardHistoryItem}
                                                                        onClick={() => handleWalletCardClick(item)}
                                                                        icon={isIncoming ? <IoArrowDown size={22} /> : <IoArrowUp size={22} />}
                                                                        iconWrapClassName={`${styles.kindIcon} ${kindClass}`}
                                                                        title={getOperationTitle(item.type)}
                                                                        subtitle={amountLine}
                                                                        rightTop={getStatusLabel(item.status)}
                                                                        rightBottom={dateTimeLine}
                                                                        rowClassName={styles.cardRow}
                                                                        leftClassName={styles.summaryLeft}
                                                                        textClassName={styles.summaryText}
                                                                        titleClassName={styles.summaryDirection}
                                                                        subtitleClassName={styles.summaryAddress}
                                                                        rightClassName={styles.summaryRight}
                                                                        rightTopClassName={styles.summaryAsset}
                                                                        rightBottomClassName={styles.summaryDate}
                                                                    />
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        {isNftLoading && (
                                            <WalletPageSkeleton variant="nft" groupCount={2} cardsPerGroup={3} />
                                        )}

                                        {!isNftLoading && nftError && (
                                            <div className={styles.errorState}>{nftError}</div>
                                        )}

                                        {!isNftLoading && !nftError && groupedNftTransactions.length === 0 && (
                                            <div className={styles.emptyState}>
                                                {t('transactions_empty') || 'No transactions for selected period'}
                                            </div>
                                        )}

                                        {!isNftLoading && !nftError && groupedNftTransactions.length > 0 && (
                                            <section className={styles.groupList}>
                                                {groupedNftTransactions.map((group) => (
                                                    <div key={group.key} className={styles.groupSection}>
                                                        <h3 className={styles.groupTitle}>{group.label}</h3>
                                                        <div className={styles.cards}>
                                                            {group.items.map((item) => {
                                                                const displayKind = resolveNftDisplayKind(item);
                                                                const counterpartAddress = displayKind === 'received' || displayKind === 'minted'
                                                                    ? (item.fromFriendly || item.from)
                                                                    : (item.toFriendly || item.to);
                                                                const counterpartLabel = counterpartAddress
                                                                    ? formatWalletShortLabel(counterpartAddress)
                                                                    : (t('system') || 'System');
                                                                const cardKindClassName = getNftKindClassName(displayKind);
                                                                const cardDateTimeLine = `${formatHistoryDate(item.timestamp, locale)}, ${formatHistoryTime(item.timestamp, locale)}`;

                                                                return (
                                                                    <TxCard
                                                                        key={item.id}
                                                                        className={styles.nftCard}
                                                                        onClick={() => handleNftCardClick(item)}
                                                                        icon={getNftKindIcon(displayKind, 22)}
                                                                        iconWrapClassName={`${styles.kindIcon} ${cardKindClassName}`}
                                                                        title={getNftDirectionLabel(displayKind)}
                                                                        subtitle={counterpartLabel}
                                                                        rightTop={t('transactions_asset_nft') || 'NFT'}
                                                                        rightBottom={cardDateTimeLine}
                                                                        rowClassName={styles.cardRow}
                                                                        leftClassName={styles.summaryLeft}
                                                                        textClassName={styles.summaryText}
                                                                        titleClassName={styles.summaryDirection}
                                                                        subtitleClassName={styles.summaryAddress}
                                                                        rightClassName={styles.summaryRight}
                                                                        rightTopClassName={styles.summaryAsset}
                                                                        rightBottomClassName={styles.summaryDate}
                                                                    />
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ))}
                                            </section>
                                        )}
                                    </>
                                )}
                            </section>
                        </>
                    ) : (
                        <>
                            <Card className={styles.card}>
                                <div className={styles.headerRow}>
                                    <div className={styles.headerIconWrap}>
                                        <IoShieldCheckmark size={18} />
                                    </div>
                                    <div className={styles.headerTextWrap}>
                                        <h1 className={styles.title}>{tr('wallet_v2_onboarding_title', 'Wallet v2 onboarding')}</h1>
                                        <p className={styles.subtitle}>
                                            {tr(
                                                'wallet_v2_onboarding_subtitle',
                                                'Create a new wallet or import using your 24 recovery words.',
                                            )}
                                        </p>
                                    </div>
                                </div>
                            </Card>

                            <SegmentedTabs
                                ariaLabel={tr('wallet_v2_onboarding_mode', 'Wallet v2 onboarding mode')}
                                items={[
                                    { key: 'create', label: tr('wallet_v2_create_wallet', 'Create wallet') },
                                    { key: 'import', label: tr('wallet_v2_import_wallet', 'Import wallet') },
                                ]}
                                activeKey={mode}
                                onChange={(nextMode) => {
                                    setMode(nextMode);
                                    setRequestError('');
                                    setRequestSuccess('');
                                    haptic.selection();
                                }}
                                className={styles.modeTabs}
                            />

                            {mode === 'create' ? (
                                <Card className={styles.card}>
                                    <div className={styles.formSection}>
                                        <p className={styles.sectionTitle}>{tr('wallet_v2_create_wallet', 'Create wallet')}</p>
                                        <p className={styles.sectionHint}>
                                            {tr(
                                                'wallet_v2_create_hint',
                                                'Set PIN for transaction confirmation. Recovery phrase will be shown after wallet creation.',
                                            )}
                                        </p>

                                        <p className={styles.fieldHint}>
                                            {tr('wallet_v2_pin_length', 'PIN length')}: {PIN_MAX_LENGTH} {tr('wallet_v2_digits', 'digits')}.
                                            {' '}
                                            {tr('wallet_v2_setup_before_create', 'Secure PIN setup opens before generation.')}
                                        </p>

                                        <Button
                                            variant="primary"
                                            fullWidth
                                            isLoading={isSubmitting}
                                            onClick={() => {
                                                handleOpenCreatePinSetup();
                                            }}
                                            disabled={!canSubmitCreate}
                                        >
                                            {tr('wallet_v2_create_wallet', 'Create wallet')}
                                        </Button>
                                    </div>
                                </Card>
                            ) : (
                                <Card className={styles.card}>
                                    <div className={styles.formSection}>
                                        <p className={styles.sectionTitle}>{tr('wallet_v2_import_wallet', 'Import wallet')}</p>
                                        <p className={styles.sectionHint}>
                                            {tr(
                                                'wallet_v2_import_hint',
                                                'Paste all 24 recovery words in the original order and set a new PIN.',
                                            )}
                                        </p>

                                        <label className={styles.field}>
                                            <span className={styles.fieldLabel}>{tr('wallet_v2_recovery_words', 'Recovery words')}</span>
                                            <textarea
                                                rows={4}
                                                className={styles.textarea}
                                                placeholder={tr('wallet_v2_recovery_placeholder', 'word1 word2 ... word24')}
                                                value={importMnemonicInput}
                                                onChange={(event) => {
                                                    setImportMnemonicInput(event.target.value);
                                                    setRequestError('');
                                                }}
                                            />
                                        </label>

                                        <p className={`${styles.fieldHint} ${hasValidMnemonicCount ? styles.fieldHintOk : ''}`}>
                                            {tr('wallet_v2_words_detected', 'Words detected')}: {parsedImportWords.length}/{MNEMONIC_WORDS_COUNT}
                                        </p>

                                        <Button
                                            variant="primary"
                                            fullWidth
                                            isLoading={isSubmitting}
                                            onClick={() => {
                                                handleOpenImportPinSetup();
                                            }}
                                            disabled={!canSubmitImport}
                                        >
                                            {tr('wallet_v2_import_wallet', 'Import wallet')}
                                        </Button>
                                    </div>
                                </Card>
                            )}
                        </>
                    )}

                    {isBiometricLoading && isMainView && (
                        <Card className={`${styles.card} ${styles.feedbackCard}`}>
                            <p>{tr('wallet_v2_checking', 'Checking...')}</p>
                        </Card>
                    )}

                    {balanceError && (
                        <Card className={`${styles.card} ${styles.feedbackCard} ${styles.feedbackError}`}>
                            <p>{balanceError}</p>
                        </Card>
                    )}

                    {requestError && (
                        <Card className={`${styles.card} ${styles.feedbackCard} ${styles.feedbackError}`}>
                            <p>{requestError}</p>
                        </Card>
                    )}

                    {requestSuccess && (
                        <Card className={`${styles.card} ${styles.feedbackCard} ${styles.feedbackSuccess}`}>
                            <p>{requestSuccess}</p>
                        </Card>
                    )}

                    {!isAuthenticated && !isMainView && (
                        <Card className={`${styles.card} ${styles.feedbackCard}`}>
                            <p>{t('login_required') || 'Login required'}</p>
                        </Card>
                    )}
                </main>
            </div>

            <BottomDrawer
                open={Boolean(selectedWalletTransaction)}
                onClose={closeWalletDetails}
                title={t('transactions_details') || 'Transfer details'}
                closeAriaLabel={t('transactions_close') || 'Close'}
                mode="static"
                overlayClassName={styles.walletDetailsOverlay}
                drawerClassName={styles.walletDetailsDrawer}
                bodyClassName={styles.drawerBodyPlain}
            >
                {selectedWalletTransaction && (
                    <div className={styles.walletDetailsBody}>
                        <section className={styles.walletDetailsTop}>
                            <span className={`${styles.kindIcon} ${selectedWalletKindClass}`}>
                                {selectedWalletIcon}
                            </span>
                            <h4 className={styles.walletDetailsName}>{selectedWalletDirectionLabel}</h4>
                            <div className={styles.walletDetailsTypeDate}>
                                <span className={styles.summaryAsset}>{selectedWalletAsset}</span>
                                <span className={styles.summaryDate}>{selectedWalletDateTimeLine}</span>
                            </div>
                        </section>

                        <section className={styles.walletDetailsBottom}>
                            <DetailsTable
                                className={styles.nftDetailsTable}
                                rowClassName={styles.nftDetailsRow}
                                keyClassName={styles.nftDetailsKey}
                                valueClassName={styles.nftDetailsValue}
                                monoValueClassName={styles.nftDetailsValueMono}
                                rows={[
                                    {
                                        id: 'sender',
                                        label: t('transactions_sender') || 'Sender',
                                        value: selectedWalletSenderValue,
                                        mono: true,
                                    },
                                    {
                                        id: 'recipient',
                                        label: t('transactions_recipient') || 'Recipient',
                                        value: selectedWalletRecipientValue,
                                        mono: true,
                                    },
                                    {
                                        id: 'amount',
                                        label: t('wallet_amount_label') || 'Amount',
                                        value: selectedWalletAmountValue,
                                    },
                                    {
                                        id: 'timestamp',
                                        label: t('transactions_timestamp') || 'Timestamp',
                                        value: selectedWalletDateTimeLine,
                                    },
                                    {
                                        id: 'status',
                                        label: t('status') || 'Status',
                                        value: selectedWalletStatus,
                                        hidden: !shouldShowWalletStatus,
                                    },
                                ]}
                            />
                        </section>
                    </div>
                )}
            </BottomDrawer>

            <BottomDrawer
                open={Boolean(selectedNftTransaction)}
                onClose={closeNftDetails}
                title={t('transactions_details') || 'Transfer details'}
                closeAriaLabel={t('transactions_close') || 'Close'}
                mode="animated"
                overlayClassName={styles.nftDetailsOverlay}
                drawerClassName={styles.nftDetailsDrawer}
                bodyClassName={styles.drawerBodyPlain}
            >
                {selectedNftTransaction && (
                    <div className={styles.nftDetailsBody}>
                        <section className={styles.nftDetailsTop}>
                            <div className={styles.nftDetailsAnimation}>
                                {selectedNftTransaction.tgsUrl ? (
                                    <TgsPlayer
                                        src={selectedNftTransaction.tgsUrl}
                                        style={{ width: 100, height: 100 }}
                                        autoplay
                                        loop={false}
                                        renderer="svg"
                                        unstyled
                                    />
                                ) : (
                                    <div className={styles.nftDetailsAnimationFallback}>
                                        {selectedNftIcon}
                                    </div>
                                )}
                            </div>
                            <h4 className={styles.nftDetailsName}>{selectedNftNameLine}</h4>
                            <div className={styles.nftDetailsTypeDate}>
                                <span className={styles.summaryAsset}>{t('transactions_asset_nft') || 'NFT'}</span>
                                <span className={styles.summaryDate}>{selectedNftDateTimeLine}</span>
                            </div>
                        </section>

                        <section className={styles.nftDetailsBottom}>
                            <DetailsTable
                                className={styles.nftDetailsTable}
                                rowClassName={styles.nftDetailsRow}
                                keyClassName={styles.nftDetailsKey}
                                valueClassName={styles.nftDetailsValue}
                                monoValueClassName={styles.nftDetailsValueMono}
                                rows={[
                                    {
                                        id: 'counterparty',
                                        label: selectedNftLowerTableLabel,
                                        value: selectedNftAddressValue,
                                        mono: true,
                                    },
                                    {
                                        id: 'fee',
                                        label: t('transactions_fee') || 'Fee',
                                        value: selectedNftFeeValue,
                                        hidden: !shouldShowNftFeeDetails,
                                    },
                                    {
                                        id: 'memo',
                                        label: t('transactions_comment') || t('transactions_memo') || 'Comment',
                                        value: selectedNftMemo,
                                        hidden: !shouldShowNftMemoDetails,
                                    },
                                ]}
                            />
                        </section>
                    </div>
                )}
            </BottomDrawer>

            <BottomDrawer
                open={isMnemonicDrawerOpen}
                onClose={closeMnemonicDrawer}
                title={tr('wallet_v2_mnemonic_title', 'Recovery phrase')}
                overlayClassName={styles.mnemonicOverlay}
                drawerClassName={styles.mnemonicDrawer}
                bodyClassName={styles.mnemonicBody}
            >
                <div className={styles.mnemonicContent}>
                    <div className={styles.mnemonicGrid}>
                        {mnemonicColumns.map((columnWords, columnIndex) => (
                            <div key={columnIndex} className={styles.mnemonicColumn}>
                                {columnWords.map((word, wordIndex) => {
                                    const visibleIndex = columnIndex * 12 + wordIndex + 1;

                                    return (
                                        <div key={`${visibleIndex}-${word}`} className={styles.mnemonicWord}>
                                            <span className={styles.mnemonicIndex}>{visibleIndex}</span>
                                            <span className={styles.mnemonicValue}>{word}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>

                    <div className={styles.mnemonicWarning}>
                        <IoWarning size={18} />
                        <p>
                            {tr(
                                'wallet_v2_settings_recovery_warning',
                                'If someone learns your 24 words, they can access your assets. Keep them private and never share.',
                            )}
                        </p>
                    </div>

                    <Button
                        variant="secondary"
                        fullWidth
                        onClick={() => {
                            void handleCopyMnemonic();
                        }}
                    >
                        {isMnemonicCopied ? <IoCheckmark size={16} /> : <IoCopy size={16} />}
                        {isMnemonicCopied
                            ? tr('wallet_copied', 'Copied')
                            : tr('wallet_v2_copy_all_words', 'Copy all words')}
                    </Button>

                    <Button
                        variant="primary"
                        fullWidth
                        onClick={closeMnemonicDrawer}
                    >
                        {tr('continue', 'Continue')}
                    </Button>
                </div>
            </BottomDrawer>

            <BottomDrawer
                open={walletDrawerMode === 'receive'}
                onClose={closeWalletDrawer}
                title={tr('wallet_receive_title', 'Receive')}
                overlayClassName={styles.walletDrawerOverlay}
                drawerClassName={styles.walletDrawer}
                bodyClassName={styles.walletDrawerBody}
            >
                <div className={styles.walletDrawerContent}>
                    {drawerError && (
                        <div className={`${styles.inlineFeedback} ${styles.inlineFeedbackError}`}>{drawerError}</div>
                    )}

                    {!drawerError && (
                        <>
                            <p className={styles.sectionHint}>
                                {tr('wallet_v2_receive_hint', 'Share this address to receive funds.')}
                            </p>

                            {isDrawerSubmitting ? (
                                <div className={styles.drawerLoading}>{tr('wallet_v2_loading_address', 'Loading address...')}</div>
                            ) : (
                                <>
                                    <div className={styles.qrWrap}>
                                        <QRCode value={receiveAddress || walletAddress || `${WALLET_V2_ADDRESS_PREFIX}-000000000000`} size={168} />
                                    </div>
                                    <div className={styles.receiveAddressBox}>
                                        <p className={styles.metaLabel}>{tr('wallet_address_label', 'Address')}</p>
                                        <p className={styles.metaValueMono}>{receiveAddress || walletAddress || '—'}</p>
                                        <p className={styles.sectionHintSmall}>
                                            {tr('wallet_v2_short', 'Short')}: {maskAddress(receiveAddress || walletAddress || '—')}
                                        </p>
                                    </div>
                                    <Button
                                        variant="secondary"
                                        fullWidth
                                        onClick={() => {
                                            void handleCopyReceiveAddress();
                                        }}
                                    >
                                        {isReceiveCopied ? <IoCheckmark size={16} /> : <IoCopy size={16} />}
                                        {isReceiveCopied
                                            ? tr('wallet_copied', 'Copied')
                                            : tr('wallet_copy', 'Copy address')}
                                    </Button>
                                </>
                            )}
                        </>
                    )}
                </div>
            </BottomDrawer>

            <BottomDrawer
                open={walletDrawerMode === 'topup'}
                onClose={closeWalletDrawer}
                title={tr('wallet_v2_testnet_topup_title', 'Testnet top up')}
                overlayClassName={styles.walletDrawerOverlay}
                drawerClassName={styles.walletDrawer}
                bodyClassName={styles.walletDrawerBody}
            >
                <div className={styles.walletDrawerContent}>
                    {drawerError && (
                        <div className={`${styles.inlineFeedback} ${styles.inlineFeedbackError}`}>{drawerError}</div>
                    )}

                    {!drawerError && (
                        <div className={styles.formSection}>
                            <p className={styles.sectionHint}>
                                {tr('wallet_v2_testnet_topup_hint', 'Add test UZS from faucet to this wallet.')}
                            </p>

                            <label className={styles.field}>
                                <span className={styles.fieldLabel}>{tr('wallet_amount_label', 'Amount')}</span>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={testnetTopupAmountInput}
                                    placeholder="0"
                                    className={styles.input}
                                    onChange={(event) => {
                                        setTestnetTopupAmountInput(formatAmountInput(event.target.value));
                                        setDrawerError('');
                                    }}
                                />
                            </label>

                            <div className={styles.sendHints}>
                                <p>
                                    {tr('wallet_v2_network', 'Network')}: <strong>{WALLET_V2_NETWORK}</strong>
                                </p>
                                <p>
                                    {tr('wallet_v2_amount_to_topup', 'Amount to top up')}:{' '}
                                    <strong>{formatIntegerString(normalizedTestnetTopupAmount || '0')}</strong>
                                </p>
                            </div>

                            <Button
                                variant="primary"
                                fullWidth
                                isLoading={isDrawerSubmitting}
                                disabled={!canApplyTestnetTopup}
                                onClick={() => {
                                    void handleApplyTestnetTopup();
                                }}
                            >
                                {tr('wallet_v2_testnet_topup_apply', 'Apply test top up')}
                            </Button>
                        </div>
                    )}
                </div>
            </BottomDrawer>

            <BottomDrawer
                open={walletDrawerMode === 'send'}
                onClose={handleSendDrawerClose}
                title={tr('wallet_send', 'Send')}
                overlayClassName={styles.walletDrawerOverlay}
                drawerClassName={styles.walletDrawer}
                bodyClassName={styles.walletDrawerBody}
                closeOnOverlayClick={sendStep !== 'confirm'}
            >
                <div className={styles.walletDrawerContent}>
                    {drawerError && (
                        <div className={`${styles.inlineFeedback} ${styles.inlineFeedbackError}`}>{drawerError}</div>
                    )}

                    {sendStep === 'input' && (
                        <div className={styles.formSection}>
                            <label className={styles.field}>
                                <span className={styles.fieldLabel}>{tr('wallet_v2_recipient_address', 'Recipient address')}</span>
                                <input
                                    type="text"
                                    value={sendAddressInput}
                                    placeholder={WALLET_V2_ADDRESS_PLACEHOLDER}
                                    className={styles.input}
                                    onChange={(event) => {
                                        setSendAddressInput(sanitizeWalletAddress(event.target.value));
                                        setDrawerError('');
                                    }}
                                />
                            </label>

                            <label className={styles.field}>
                                <span className={styles.fieldLabel}>{tr('wallet_v2_asset', 'Asset')}</span>
                                <input
                                    type="text"
                                    value={sendAssetInput}
                                    placeholder="UZS"
                                    className={styles.input}
                                    onChange={(event) => {
                                        setSendAssetInput(sanitizeAsset(event.target.value));
                                        setDrawerError('');
                                    }}
                                />
                            </label>

                            <label className={styles.field}>
                                <span className={styles.fieldLabel}>{tr('wallet_amount_label', 'Amount')}</span>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={sendAmountInput}
                                    placeholder="0"
                                    className={styles.input}
                                    onChange={(event) => {
                                        setSendAmountInput(formatAmountInput(event.target.value));
                                        setDrawerError('');
                                    }}
                                />
                            </label>

                            <div className={styles.sendHints}>
                                <p>
                                    {tr('wallet_v2_available', 'Available')} {normalizedSendAsset}:{' '}
                                    <strong>{formatIntegerString(availableForSendAsset)}</strong>
                                </p>
                                <p>
                                    {tr('wallet_v2_amount_to_send', 'Amount to send')}:{' '}
                                    <strong>{formatIntegerString(normalizedSendAmount || '0')}</strong>
                                </p>
                            </div>

                            <Button
                                variant="primary"
                                fullWidth
                                isLoading={isDrawerSubmitting}
                                disabled={!canCreateSend}
                                onClick={() => {
                                    void handleCreateSend();
                                }}
                            >
                                {tr('wallet_v2_create_transfer', 'Create transfer')}
                            </Button>
                        </div>
                    )}

                    {sendStep === 'confirm' && pendingSend && (
                        <div className={styles.formSection}>
                            <div className={styles.confirmCard}>
                                <p className={styles.sectionTitle}>{tr('wallet_v2_confirm_transfer', 'Confirm transfer')}</p>
                                <p>{tr('wallet_send_to_short_label', 'To')}: <strong className={styles.metaValueMono}>{pendingSend.toAddress}</strong></p>
                                <p>{tr('wallet_v2_asset', 'Asset')}: <strong>{pendingSend.asset}</strong></p>
                                <p>{tr('wallet_amount_label', 'Amount')}: <strong>{formatIntegerString(pendingSend.amount)}</strong></p>
                                <p className={styles.sectionHintSmall}>
                                    {tr('wallet_v2_challenge_expires', 'Challenge expires')}: {formatDateTime(pendingSend.expiresAt)}
                                </p>
                            </div>

                            <p className={styles.sectionHint}>
                                {tr(
                                    'wallet_v2_fullscreen_auth_hint',
                                    'Use secure full-screen authentication to confirm this transfer.',
                                )}
                            </p>

                            <Button
                                variant="primary"
                                fullWidth
                                isLoading={isDrawerSubmitting}
                                disabled={isDrawerSubmitting}
                                onClick={() => {
                                    setPinAuthError('');
                                    setPinAuthFlow('tx_confirm');
                                }}
                            >
                                {tr('wallet_v2_open_auth_screen', 'Open confirmation screen')}
                            </Button>
                        </div>
                    )}

                    {sendStep === 'success' && (
                        <div className={styles.sendSuccessState}>
                            <IoCheckmark size={22} />
                            <p>{tr('wallet_v2_transfer_completed', 'Transfer completed.')}</p>
                        </div>
                    )}
                </div>
            </BottomDrawer>

            {isPinAuthOpen && (
                <PinAuthScreen
                    key={pinAuthFlow}
                    open={isPinAuthOpen}
                    mode={isPinSetupFlow ? 'setup' : 'confirm'}
                    subtitle={pinAuthSubtitle}
                    backLabel={tr('back', 'Back')}
                    biometricLabel={isEntryAuthFlow
                        ? tr('wallet_v2_unlock_with_biometric', 'Unlock with biometric')
                        : tr('wallet_v2_confirm_with_biometric', 'Confirm with biometric')}
                    errorMessage={pinAuthError}
                    isSubmitting={isSubmitting || isDrawerSubmitting}
                    minLength={PIN_MIN_LENGTH}
                    maxLength={PIN_MAX_LENGTH}
                    biometricEnabled={Boolean((isTxConfirmFlow && canUsePendingBiometric) || canUseEntryBiometric)}
                    isBiometricLoading={isPinAuthBiometricLoading}
                    biometricIconKind={biometricIconKind}
                    autoTriggerBiometric={Boolean((isTxConfirmFlow && canUsePendingBiometric) || canUseEntryBiometric)}
                    details={isTxConfirmFlow ? pinAuthDetails : []}
                    onSetupComplete={handlePinSetupComplete}
                    onPinConfirm={handlePinAuthConfirm}
                    onBiometricConfirm={handlePinAuthBiometric}
                    onSetupMismatch={() => {
                        const mismatchMessage = pinAuthFlow === 'import_setup'
                            ? tr('wallet_v2_error_new_pin_mismatch', 'New PIN confirmation does not match')
                            : tr('wallet_v2_error_pin_mismatch', 'PIN confirmation does not match');
                        setPinAuthError(mismatchMessage);
                        haptic.error();
                    }}
                    onPinChange={clearPinAuthError}
                />
            )}
        </>
    );
}
