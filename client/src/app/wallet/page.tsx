'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowRight,
    Check,
    Copy,
    Loader2,
} from 'lucide-react';
import {
    IoArrowDown,
    IoArrowUp,
    IoCash,
    IoFlame,
    IoQrCode,
    IoSend,
    IoShareSocial,
    IoSparkles,
    IoWallet,
} from 'react-icons/io5';
import QRCode from 'react-qr-code';

import { BottomDrawer } from '@/components/ui/BottomDrawer';
import { DetailsTable } from '@/components/ui/DetailsTable';
import { RecipientLookupField } from '@/components/ui/RecipientLookupField';
import { RoundIconButton } from '@/components/ui/RoundIconButton';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { SwipeConfirmWithSuccess } from '@/components/ui/SwipeConfirmWithSuccess';
import { TelegramBackButton } from '@/components/ui/TelegramBackButton';
import { TgsPlayer } from '@/components/ui/TgsPlayer';
import { TxCard } from '@/components/ui/TxCard';
import { WalletPageSkeleton } from '@/components/ui/WalletPageSkeleton';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/context/LanguageContext';
import { useTelegram } from '@/lib/context/TelegramContext';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';
import {
    WALLET_FRIENDLY_BODY_LENGTH,
    WALLET_FRIENDLY_PREFIX,
    WALLET_IS_TESTNET,
    buildWalletFriendlyAddress,
    formatWalletFriendlyAddressForNetwork,
    formatWalletShortLabel,
    sanitizeWalletFriendlyBody,
} from '@/lib/wallet/network';

import styles from './page.module.css';

interface WalletInfo {
    address: string;
    friendlyAddress: string;
    nftCount: number;
    balance: number;
    createdAt: string | null;
}

interface WalletHistoryItem {
    id: string;
    type: 'topup' | 'withdraw' | 'send' | 'receive' | string;
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

interface WalletHistoryGroup {
    key: string;
    label: string;
    items: WalletHistoryItem[];
}

interface RecipientLookupResult {
    id: string;
    username: string | null;
    firstName: string | null;
    photoUrl: string | null;
    walletFriendly: string | null;
}

interface NftPartyInfo {
    id: string;
    username: string | null;
    firstName: string | null;
    photoUrl: string | null;
}

interface NftTransactionItem {
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
}

interface NftHistoryGroup {
    key: string;
    label: string;
    items: NftTransactionItem[];
}

type DrawerMode = 'topup' | 'withdraw' | 'receive' | 'send' | null;
type SendRecipientType = 'username' | 'wallet';
type SendStep = 'input' | 'confirm';
type WalletHistoryTab = 'feed' | 'nft';
type NftTxDisplayKind = 'received' | 'sent' | 'minted' | 'burn';

const QUICK_AMOUNTS = [5000, 10000, 25000, 50000, 100000];
const HISTORY_PAGE_SIZE = 20;
const WALLET_SEND_FEE = 71;
const TELEGRAM_USERNAME_MAX_LENGTH = 32;
const SEND_LOOKUP_DEBOUNCE_MS = 420;
const MAX_AMOUNT_INPUT_DIGITS = 11;
const SEND_MEMO_MAX_LENGTH = 180;

function localeToIntlCode(locale: string): string {
    if (locale === 'ru') return 'ru-RU';
    if (locale === 'uz') return 'uz-UZ';
    return 'en-US';
}

function safeErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    return 'Request failed';
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

function formatDetailsDate(value: string, locale: string): string {
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

function formatTime(value: string, locale: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }

    return new Intl.DateTimeFormat(localeToIntlCode(locale), {
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function sanitizeUsernameInput(value: string): string {
    const candidate = value.trim().replace(/^@+/, '');
    return candidate.replace(/[^a-zA-Z0-9_]/g, '').slice(0, TELEGRAM_USERNAME_MAX_LENGTH);
}

function normalizeAmountDigits(value: string): string {
    const digitsOnly = value.replace(/[^0-9]/g, '').slice(0, MAX_AMOUNT_INPUT_DIGITS);
    return digitsOnly.replace(/^0+(?=\d)/, '');
}

function formatAmountInput(value: string): string {
    const digits = normalizeAmountDigits(value);
    if (!digits) {
        return '';
    }

    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function sanitizeSendMemo(value: string): string {
    return value.slice(0, SEND_MEMO_MAX_LENGTH);
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

export default function WalletPage() {
    const { t, locale } = useLanguage();
    const { user, authUser, isAuthenticated, haptic, webApp } = useTelegram();

    const [wallet, setWallet] = useState<WalletInfo | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [historyItems, setHistoryItems] = useState<WalletHistoryItem[]>([]);
    const [historyCursor, setHistoryCursor] = useState<string | null>(null);
    const [historyHasMore, setHistoryHasMore] = useState(false);
    const [isHistoryLoading, setIsHistoryLoading] = useState(true);
    const [isHistoryLoadingMore, setIsHistoryLoadingMore] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [activeHistoryTab, setActiveHistoryTab] = useState<WalletHistoryTab>('feed');
    const [nftTransactions, setNftTransactions] = useState<NftTransactionItem[]>([]);
    const [isNftLoading, setIsNftLoading] = useState(true);
    const [nftError, setNftError] = useState<string | null>(null);
    const [selectedNftTransaction, setSelectedNftTransaction] = useState<NftTransactionItem | null>(null);
    const [selectedWalletTransaction, setSelectedWalletTransaction] = useState<WalletHistoryItem | null>(null);

    const [copiedInDrawer, setCopiedInDrawer] = useState(false);

    const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
    const [amountInput, setAmountInput] = useState('');
    const [selectedQuick, setSelectedQuick] = useState<number | null>(null);
    const [drawerError, setDrawerError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [recipientType, setRecipientType] = useState<SendRecipientType>('username');
    const [usernameInput, setUsernameInput] = useState('');
    const [walletBodyInput, setWalletBodyInput] = useState('');
    const [sendStep, setSendStep] = useState<SendStep>('input');
    const [sendMemoInput, setSendMemoInput] = useState('');
    const [isSendConfirmSucceeded, setIsSendConfirmSucceeded] = useState(false);
    const [recipientLookup, setRecipientLookup] = useState<RecipientLookupResult | null>(null);
    const lookupSeqRef = useRef(0);
    const nftDetailsTouchStartY = useRef<number | null>(null);
    const nftDetailsTouchCurrentY = useRef<number | null>(null);

    useBodyScrollLock(Boolean(drawerMode) || Boolean(selectedNftTransaction) || Boolean(selectedWalletTransaction));

    const formatCurrency = useCallback((amount: number) => {
        return new Intl.NumberFormat(localeToIntlCode(locale), {
            maximumFractionDigits: 0,
        }).format(amount);
    }, [locale]);

    const loadWallet = useCallback(async () => {
        if (!isAuthenticated || !authUser?.uid) {
            setIsLoading(false);
            setWallet(null);
            setError(t('login_required') || 'Login required');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            let response;
            try {
                response = await api.wallet.info(authUser.uid);
            } catch (infoError) {
                const infoMessage = safeErrorMessage(infoError).toLowerCase();
                const hasNoWallet = infoMessage.includes('no wallet') || infoMessage.includes('wallet not found');

                if (!hasNoWallet) {
                    throw infoError;
                }

                await api.wallet.create(authUser.uid);
                response = await api.wallet.info(authUser.uid);
            }

            setWallet(response.wallet);
        } catch (loadError) {
            setError(safeErrorMessage(loadError));
            setWallet(null);
        } finally {
            setIsLoading(false);
        }
    }, [authUser?.uid, isAuthenticated, t]);

    const loadHistory = useCallback(async (
        options: {
            cursor?: string | null;
            append?: boolean;
        } = {},
    ) => {
        const { cursor = null, append = false } = options;

        if (!isAuthenticated || !authUser?.uid) {
            setHistoryItems([]);
            setHistoryCursor(null);
            setHistoryHasMore(false);
            setHistoryError(t('login_required') || 'Login required');
            setIsHistoryLoading(false);
            setIsHistoryLoadingMore(false);
            return;
        }

        if (append) {
            setIsHistoryLoadingMore(true);
        } else {
            setIsHistoryLoading(true);
        }

        setHistoryError(null);

        try {
            const response = await api.wallet.operations({
                limit: HISTORY_PAGE_SIZE,
                ...(cursor ? { cursor } : {}),
            });

            const incoming = response.items || [];

            if (append) {
                setHistoryItems((prev) => {
                    const seen = new Set(prev.map((item) => item.id));
                    const merged = [...prev];

                    incoming.forEach((item) => {
                        if (!seen.has(item.id)) {
                            seen.add(item.id);
                            merged.push(item);
                        }
                    });

                    return merged;
                });
            } else {
                setHistoryItems(incoming);
            }

            setHistoryCursor(response.nextCursor || null);
            setHistoryHasMore(Boolean(response.hasMore && response.nextCursor));
        } catch (loadError) {
            setHistoryError(safeErrorMessage(loadError));

            if (!append) {
                setHistoryItems([]);
                setHistoryCursor(null);
                setHistoryHasMore(false);
            }
        } finally {
            if (append) {
                setIsHistoryLoadingMore(false);
            } else {
                setIsHistoryLoading(false);
            }
        }
    }, [authUser?.uid, isAuthenticated, t]);

    const loadNftTransactions = useCallback(async () => {
        if (!isAuthenticated || !authUser?.uid) {
            setNftTransactions([]);
            setNftError(t('login_required') || 'Login required');
            setIsNftLoading(false);
            return;
        }

        setIsNftLoading(true);
        setNftError(null);

        try {
            const response = await api.transactions.list({ limit: 200 });
            setNftTransactions(response.transactions || []);
        } catch (loadError) {
            setNftTransactions([]);
            setNftError(safeErrorMessage(loadError));
        } finally {
            setIsNftLoading(false);
        }
    }, [authUser?.uid, isAuthenticated, t]);

    useEffect(() => {
        void loadWallet();
        void loadHistory();
        void loadNftTransactions();
    }, [loadHistory, loadNftTransactions, loadWallet]);

    const copyValue = useMemo(() => {
        const friendly = (wallet?.friendlyAddress || user?.walletFriendly || '').trim();
        if (friendly) {
            return formatWalletFriendlyAddressForNetwork(friendly);
        }

        return (wallet?.address || user?.walletAddress || '').trim();
    }, [wallet?.address, wallet?.friendlyAddress, user?.walletAddress, user?.walletFriendly]);

    const receiveWalletValue = useMemo(() => {
        return formatWalletShortLabel(copyValue || null);
    }, [copyValue]);

    const parsedAmount = useMemo(() => {
        const normalized = normalizeAmountDigits(amountInput);
        if (!normalized) {
            return null;
        }

        const parsed = Number.parseInt(normalized, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
            return null;
        }

        return parsed;
    }, [amountInput]);

    const normalizedUsername = useMemo(() => sanitizeUsernameInput(usernameInput), [usernameInput]);
    const normalizedWalletBody = useMemo(() => sanitizeWalletFriendlyBody(walletBodyInput), [walletBodyInput]);
    const resolvedLookupUsername = useMemo(
        () => sanitizeUsernameInput(recipientLookup?.username || ''),
        [recipientLookup?.username],
    );
    const hasExactUsernameMatch = useMemo(() => {
        if (!normalizedUsername || !resolvedLookupUsername) {
            return false;
        }

        return normalizedUsername.toLowerCase() === resolvedLookupUsername.toLowerCase();
    }, [normalizedUsername, resolvedLookupUsername]);
    const suggestedWallet = useMemo(() => {
        if (!hasExactUsernameMatch) {
            return '';
        }

        const source = sanitizeWalletFriendlyBody(recipientLookup?.walletFriendly || '');
        if (!source) {
            return '';
        }

        return `${WALLET_FRIENDLY_PREFIX}${source}`;
    }, [hasExactUsernameMatch, recipientLookup?.walletFriendly]);
    const suggestionDisplayName = useMemo(() => {
        if (resolvedLookupUsername) {
            return `@${resolvedLookupUsername}`;
        }

        const firstName = (recipientLookup?.firstName || '').trim();
        if (firstName) {
            return firstName;
        }

        return t('wallet_send_to_label') || 'Recipient';
    }, [recipientLookup?.firstName, resolvedLookupUsername, t]);
    useEffect(() => {
        if (drawerMode !== 'send' || sendStep !== 'input' || recipientType !== 'username') {
            lookupSeqRef.current += 1;
            return;
        }

        const usernameLookup = normalizedUsername.toLowerCase();
        if (usernameLookup.length < 2) {
            lookupSeqRef.current += 1;
            setRecipientLookup(null);
            return;
        }

        const lookupSeq = ++lookupSeqRef.current;
        const timeoutId = window.setTimeout(async () => {
            try {
                const response = await api.nft.findRecipientByUsername(
                    usernameLookup,
                    webApp?.initData || undefined,
                );

                if (lookupSeqRef.current !== lookupSeq) {
                    return;
                }

                const nextRecipient = response?.recipient || null;
                const nextUsername = sanitizeUsernameInput(nextRecipient?.username || '');

                if (nextRecipient && nextUsername && nextUsername.toLowerCase() === usernameLookup) {
                    setRecipientLookup(nextRecipient);
                } else {
                    setRecipientLookup(null);
                }
            } catch {
                if (lookupSeqRef.current === lookupSeq) {
                    setRecipientLookup(null);
                }
            }
        }, SEND_LOOKUP_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [drawerMode, normalizedUsername, recipientType, sendStep, webApp?.initData]);

    const sendTotalDebit = useMemo(() => {
        if (!parsedAmount) {
            return null;
        }

        return parsedAmount + WALLET_SEND_FEE;
    }, [parsedAmount]);

    const sendRecipientByWallet = recipientType === 'wallet' ? normalizedWalletBody : '';
    const hasSendRecipient = recipientType === 'wallet'
        ? sendRecipientByWallet.length > 0
        : hasExactUsernameMatch;
    const canContinueSend = Boolean(
        parsedAmount
        && sendTotalDebit
        && hasSendRecipient
        && sendTotalDebit <= (wallet?.balance || 0),
    );
    const sendRecipientDisplay = recipientType === 'username'
        ? `@${resolvedLookupUsername || normalizedUsername}`
        : `${WALLET_FRIENDLY_PREFIX}${normalizedWalletBody}`;
    const sendMemoLength = sendMemoInput.length;

    const groupedHistory = useMemo<WalletHistoryGroup[]>(() => {
        const groupsMap = new Map<string, WalletHistoryItem[]>();

        historyItems.forEach((item) => {
            const key = dateKeyFromTimestamp(item.createdAt);
            const current = groupsMap.get(key);

            if (current) {
                current.push(item);
            } else {
                groupsMap.set(key, [item]);
            }
        });

        return Array.from(groupsMap.entries()).map(([key, items]) => ({
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

    const handleWalletCardClick = useCallback((item: WalletHistoryItem) => {
        haptic.impact('light');
        setSelectedNftTransaction(null);
        setSelectedWalletTransaction(item);
    }, [haptic]);

    const nftDetailsSwipeHandlers = {
        onTouchStart: (event: React.TouchEvent<HTMLDivElement>) => {
            nftDetailsTouchStartY.current = event.touches[0]?.clientY ?? null;
            nftDetailsTouchCurrentY.current = nftDetailsTouchStartY.current;
        },
        onTouchMove: (event: React.TouchEvent<HTMLDivElement>) => {
            nftDetailsTouchCurrentY.current = event.touches[0]?.clientY ?? null;
        },
        onTouchEnd: () => {
            const startY = nftDetailsTouchStartY.current;
            const currentY = nftDetailsTouchCurrentY.current;

            nftDetailsTouchStartY.current = null;
            nftDetailsTouchCurrentY.current = null;

            if (startY === null || currentY === null) {
                return;
            }

            if (currentY - startY > 72) {
                closeNftDetails();
            }
        },
    };

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

    const selectedNftKind = selectedNftTransaction ? resolveNftDisplayKind(selectedNftTransaction) : null;
    const selectedNftTitle = selectedNftTransaction?.collectionName
        || selectedNftTransaction?.modelName
        || (t('transactions_asset_nft') || 'NFT');
    const selectedNftSerial = selectedNftTransaction?.serialNumber ? `#${selectedNftTransaction.serialNumber}` : '';
    const selectedNftDateLabel = selectedNftTransaction ? formatDetailsDate(selectedNftTransaction.timestamp, locale) : '—';
    const selectedNftTimeLabel = selectedNftTransaction ? formatTime(selectedNftTransaction.timestamp, locale) : '—';
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
    const shouldShowNftFeeDetails = Boolean(
        selectedNftFeeValue
        && selectedNftTransaction
        && (
            selectedNftTransaction.direction === 'out'
            || (selectedNftTransaction.fromUser?.id === authUser?.uid)
        ),
    );
    const selectedNftNameLine = `${selectedNftTitle}${selectedNftSerial ? ` ${selectedNftSerial}` : ''}`;
    const selectedNftDateTimeLine = `${selectedNftDateLabel}, ${selectedNftTimeLabel}`;
    const selectedNftIcon = selectedNftKind ? getNftKindIcon(selectedNftKind) : <IoArrowUp size={18} />;

    const ownWalletAddress = wallet?.address || user?.walletAddress || null;
    const ownWalletFriendly = wallet?.friendlyAddress || user?.walletFriendly || null;
    const ownWalletLabel = formatWalletShortLabel(ownWalletFriendly || ownWalletAddress);
    const selectedWalletDirectionLabel = selectedWalletTransaction
        ? (selectedWalletTransaction.type === 'topup'
            ? (t('wallet_history_operation_topup') || 'Top up')
            : selectedWalletTransaction.type === 'withdraw'
                ? (t('wallet_history_operation_withdraw') || 'Withdraw')
                : selectedWalletTransaction.type === 'send'
                    ? (t('wallet_history_operation_send') || 'Send')
                    : selectedWalletTransaction.type === 'receive'
                        ? (t('wallet_history_operation_receive') || 'Receive')
                        : selectedWalletTransaction.type)
        : '—';
    const selectedWalletIsIncoming = selectedWalletTransaction
        ? selectedWalletTransaction.type === 'topup' || selectedWalletTransaction.type === 'receive'
        : false;
    const selectedWalletKindClass = selectedWalletIsIncoming ? styles.kindReceived : styles.kindSent;
    const selectedWalletIcon = selectedWalletIsIncoming
        ? <IoArrowDown size={22} />
        : <IoArrowUp size={22} />;
    const selectedWalletDateLabel = selectedWalletTransaction
        ? formatDetailsDate(selectedWalletTransaction.createdAt, locale)
        : '—';
    const selectedWalletTimeLabel = selectedWalletTransaction
        ? formatTime(selectedWalletTransaction.createdAt, locale)
        : '—';
    const selectedWalletDateTimeLine = `${selectedWalletDateLabel}, ${selectedWalletTimeLabel}`;
    const selectedWalletIsTopup = selectedWalletTransaction?.type === 'topup';
    const selectedWalletStatus = (() => {
        const status = selectedWalletTransaction?.status || '';
        const normalized = status.trim().toLowerCase();

        if (normalized === 'completed' || !normalized) {
            return t('wallet_history_status_completed') || 'Completed';
        }

        return status;
    })();
    const selectedWalletSenderRaw = selectedWalletTransaction
        ? (selectedWalletTransaction.fromFriendly || selectedWalletTransaction.fromAddress)
        : null;
    const selectedWalletRecipientRaw = selectedWalletTransaction
        ? (selectedWalletTransaction.toFriendly || selectedWalletTransaction.toAddress)
        : null;
    const selectedWalletSenderValue = selectedWalletIsTopup
        ? (t('system') || 'System')
        : selectedWalletSenderRaw
            ? formatWalletShortLabel(selectedWalletSenderRaw)
            : (
                selectedWalletTransaction?.type === 'send' || selectedWalletTransaction?.type === 'withdraw'
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
        ? `${formatCurrency(selectedWalletTransaction.amount)} ${selectedWalletTransaction.currency || 'UZS'}`
        : '—';
    const selectedWalletMemo = (selectedWalletTransaction?.memo || '').trim();
    const shouldShowWalletMemo = selectedWalletMemo.length > 0 && !selectedWalletIsTopup;
    const shouldShowWalletStatus = !selectedWalletIsTopup;
    const selectedWalletFeeAmount = selectedWalletTransaction
        ? (selectedWalletTransaction.feeAmount ?? (selectedWalletTransaction.type === 'send' ? WALLET_SEND_FEE : null))
        : null;
    const selectedWalletFeeCurrency = selectedWalletTransaction?.feeCurrency || selectedWalletTransaction?.currency || 'UZS';
    const isWalletSender = Boolean(
        selectedWalletTransaction
        && ownWalletAddress
        && selectedWalletTransaction.fromAddress
        && selectedWalletTransaction.fromAddress === ownWalletAddress,
    ) || selectedWalletTransaction?.type === 'send';
    const shouldShowWalletFee = Boolean(isWalletSender && selectedWalletFeeAmount !== null);
    const selectedWalletFeeValue = selectedWalletFeeAmount !== null
        ? `${formatCurrency(selectedWalletFeeAmount)} ${selectedWalletFeeCurrency}`
        : '—';

    const openDrawer = (mode: Exclude<DrawerMode, null>) => {
        if (mode === 'topup' && !WALLET_IS_TESTNET) {
            haptic.warning();
            return;
        }

        haptic.impact('light');
        setSelectedNftTransaction(null);
        setSelectedWalletTransaction(null);
        setDrawerMode(mode);
        setDrawerError('');
        setCopiedInDrawer(false);

        if (mode === 'receive') {
            setSelectedQuick(null);
            setAmountInput('');
            return;
        }

        if (mode === 'send') {
            setSendStep('input');
            setIsSendConfirmSucceeded(false);
            return;
        }

        const defaultAmount = QUICK_AMOUNTS[1];
        setSelectedQuick(defaultAmount);
        setAmountInput(formatAmountInput(String(defaultAmount)));
    };

    const closeDrawer = useCallback((force = false) => {
        if (isSubmitting && !force) {
            return;
        }

        setDrawerMode(null);
        setDrawerError('');
        setCopiedInDrawer(false);
        setIsSendConfirmSucceeded(false);

        if (drawerMode !== 'send') {
            setAmountInput('');
            setSelectedQuick(null);
        }
    }, [drawerMode, isSubmitting]);

    const writeToClipboard = useCallback(async (value: string) => {
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
    }, []);

    const handleCopyAddressInDrawer = useCallback(async () => {
        if (!copyValue) {
            return;
        }

        haptic.impact('light');

        try {
            await writeToClipboard(copyValue);
            setCopiedInDrawer(true);
            haptic.success();
            window.setTimeout(() => setCopiedInDrawer(false), 1500);
        } catch {
            haptic.error();
        }
    }, [copyValue, haptic, writeToClipboard]);

    const handleShareAddress = useCallback(async () => {
        if (!copyValue) {
            return;
        }

        haptic.selection();
        const shareText = `${t('wallet_receive_share_text') || 'My wallet address'}: ${copyValue}`;
        const shareUrl = `https://t.me/share/url?url=&text=${encodeURIComponent(shareText)}`;

        try {
            if (webApp?.openTelegramLink) {
                webApp.openTelegramLink(shareUrl);
            } else if (navigator.share) {
                await navigator.share({ text: shareText });
            } else {
                window.open(shareUrl, '_blank', 'noopener,noreferrer');
            }

            haptic.success();
        } catch {
            haptic.error();
        }
    }, [copyValue, haptic, t, webApp]);

    const handleApplyBalanceMutation = async () => {
        if (drawerMode !== 'topup' && drawerMode !== 'withdraw') {
            return;
        }

        if (isSubmitting) {
            return;
        }

        if (!parsedAmount) {
            setDrawerError(t('wallet_amount_invalid') || 'Enter valid amount');
            haptic.error();
            return;
        }

        if (drawerMode === 'withdraw' && parsedAmount > (wallet?.balance || 0)) {
            setDrawerError(t('wallet_insufficient') || 'Insufficient balance');
            haptic.error();
            return;
        }

        setIsSubmitting(true);
        setDrawerError('');

        try {
            if (drawerMode === 'topup') {
                await api.wallet.topup(parsedAmount);
            } else {
                await api.wallet.withdraw(parsedAmount);
            }

            await Promise.all([
                loadWallet(),
                loadHistory({ cursor: null, append: false }),
            ]);

            haptic.success();
            setAmountInput('');
            setSelectedQuick(null);
            setRecipientType('username');
            setUsernameInput('');
            setWalletBodyInput('');
            setRecipientLookup(null);
            closeDrawer(true);
        } catch (applyError) {
            setDrawerError(safeErrorMessage(applyError));
            haptic.error();
        } finally {
            setIsSubmitting(false);
        }
    };

    const validateSendInput = useCallback((withHaptic = true) => {
        if (!parsedAmount) {
            setDrawerError(t('wallet_amount_invalid') || 'Enter valid amount');
            if (withHaptic) {
                haptic.error();
            }
            return null;
        }

        const recipientByUsername = recipientType === 'username' ? normalizedUsername : '';
        const recipientByWallet = recipientType === 'wallet' ? normalizedWalletBody : '';

        if (recipientType === 'username' && !hasExactUsernameMatch) {
            setDrawerError(t('recipient_not_found') || 'User not found');
            if (withHaptic) {
                haptic.error();
            }
            return null;
        }

        if (!recipientByUsername && !recipientByWallet) {
            setDrawerError(t('recipient_required') || 'Recipient is required');
            if (withHaptic) {
                haptic.error();
            }
            return null;
        }

        const requiredBalance = parsedAmount + WALLET_SEND_FEE;
        if (requiredBalance > (wallet?.balance || 0)) {
            const fallback = `Need ${formatCurrency(requiredBalance)} UZS`;
            setDrawerError(t('wallet_send_insufficient') || fallback);
            if (withHaptic) {
                haptic.error();
            }
            return null;
        }

        return {
            amount: parsedAmount,
            recipientByUsername,
            recipientByWallet,
        };
    }, [
        formatCurrency,
        hasExactUsernameMatch,
        haptic,
        normalizedUsername,
        normalizedWalletBody,
        parsedAmount,
        recipientType,
        t,
        wallet?.balance,
    ]);

    const handleContinueSend = () => {
        if (drawerMode !== 'send' || isSubmitting) {
            return;
        }

        const payload = validateSendInput();
        if (!payload) {
            return;
        }

        setDrawerError('');
        setIsSendConfirmSucceeded(false);
        setSendStep('confirm');
        haptic.impact('light');
    };

    const handleBackFromSendConfirm = () => {
        if (isSubmitting || isSendConfirmSucceeded) {
            return;
        }

        setSendStep('input');
        setDrawerError('');
        setIsSendConfirmSucceeded(false);
        haptic.impact('light');
    };

    const handleApplySend = useCallback(async (): Promise<boolean> => {
        if (drawerMode !== 'send') {
            return false;
        }

        if (isSubmitting) {
            return false;
        }

        const payload = validateSendInput();
        if (!payload) {
            return false;
        }

        setIsSubmitting(true);
        setDrawerError('');

        try {
            const trimmedMemo = sendMemoInput.trim();
            await api.wallet.send({
                amount: payload.amount,
                ...(payload.recipientByUsername
                    ? { toUsername: payload.recipientByUsername }
                    : { toAddress: buildWalletFriendlyAddress(payload.recipientByWallet) }),
                ...(trimmedMemo ? { memo: trimmedMemo } : {}),
            });

            await Promise.all([
                loadWallet(),
                loadHistory({ cursor: null, append: false }),
            ]);

            haptic.success();
            setIsSendConfirmSucceeded(true);
            return true;
        } catch (applyError) {
            setDrawerError(safeErrorMessage(applyError));
            haptic.error();
            return false;
        } finally {
            setIsSubmitting(false);
        }
    }, [
        drawerMode,
        isSubmitting,
        validateSendInput,
        sendMemoInput,
        loadWallet,
        loadHistory,
        haptic,
    ]);

    const handleSendConfirmAutoClose = useCallback(() => {
        setSendStep('input');
        setSendMemoInput('');
        setRecipientType('username');
        setUsernameInput('');
        setWalletBodyInput('');
        setRecipientLookup(null);
        setAmountInput('');
        setIsSendConfirmSucceeded(false);
        closeDrawer(true);
    }, [closeDrawer]);

    const handleLoadMore = () => {
        if (!historyHasMore || !historyCursor || isHistoryLoadingMore) {
            return;
        }

        haptic.selection();
        void loadHistory({ cursor: historyCursor, append: true });
    };

    const getOperationTitle = (type: WalletHistoryItem['type']) => {
        if (type === 'topup') {
            return t('wallet_history_operation_topup') || 'Top up';
        }

        if (type === 'withdraw') {
            return t('wallet_history_operation_withdraw') || 'Withdraw';
        }

        if (type === 'send') {
            return t('wallet_history_operation_send') || 'Send';
        }

        if (type === 'receive') {
            return t('wallet_history_operation_receive') || 'Receive';
        }

        return type;
    };

    const getStatusLabel = (status: string) => {
        const normalized = status.trim().toLowerCase();

        if (normalized === 'completed') {
            return t('wallet_history_status_completed') || 'Completed';
        }

        if (!normalized) {
            return t('wallet_history_status_completed') || 'Completed';
        }

        return status;
    };

    return (
        <>
            <TelegramBackButton href="/profile" />

            <div className={styles.container}>
                <main className={styles.main}>
                    {isLoading && <WalletPageSkeleton variant="full" />}

                    {!isLoading && error && (
                        <section className={styles.card}>
                            <p className={styles.errorText}>{error}</p>
                        </section>
                    )}

                    {!isLoading && !error && wallet && (
                        <>
                            <section className={`${styles.card} ${styles.balanceCard}`}>
                                <div className={styles.balanceBadge}>
                                    <IoWallet size={16} />
                                    <span>{t('wallet_balance_label') || 'Balance'}</span>
                                </div>

                                <div className={styles.balanceValueWrap}>
                                    <strong className={styles.balanceValue}>{formatCurrency(wallet.balance)}</strong>
                                    <span className={styles.balanceCurrency}>UZS</span>
                                </div>

                                <div className={styles.actionRow}>
                                    <button
                                        type="button"
                                        className={styles.actionTile}
                                        onClick={() => openDrawer('topup')}
                                        disabled={!WALLET_IS_TESTNET}
                                    >
                                        <RoundIconButton as="span" size={50} className={`${styles.actionIcon} ${styles.actionIconTopup}`}>
                                            <IoWallet size={20} />
                                        </RoundIconButton>
                                        <span className={styles.actionLabel}>{t('wallet_topup') || 'Top up'}</span>
                                    </button>

                                    <button
                                        type="button"
                                        className={styles.actionTile}
                                        onClick={() => openDrawer('withdraw')}
                                        disabled={wallet.balance <= 0}
                                    >
                                        <RoundIconButton as="span" size={50} className={`${styles.actionIcon} ${styles.actionIconWithdraw}`}>
                                            <IoCash size={20} />
                                        </RoundIconButton>
                                        <span className={styles.actionLabel}>{t('wallet_withdraw') || 'Withdraw'}</span>
                                    </button>

                                    <button
                                        type="button"
                                        className={styles.actionTile}
                                        onClick={() => openDrawer('receive')}
                                        disabled={!copyValue}
                                    >
                                        <RoundIconButton as="span" size={50} className={`${styles.actionIcon} ${styles.actionIconReceive}`}>
                                            <IoQrCode size={20} />
                                        </RoundIconButton>
                                        <span className={styles.actionLabel}>{t('wallet_receive') || 'Receive'}</span>
                                    </button>

                                    <button
                                        type="button"
                                        className={styles.actionTile}
                                        onClick={() => openDrawer('send')}
                                        disabled={wallet.balance <= WALLET_SEND_FEE}
                                    >
                                        <RoundIconButton as="span" size={50} className={`${styles.actionIcon} ${styles.actionIconSend}`}>
                                            <IoSend size={20} />
                                        </RoundIconButton>
                                        <span className={styles.actionLabel}>{t('wallet_send') || t('send') || 'Send'}</span>
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
                                                {t('wallet_history_empty') || 'There are currently no wallet operations'}
                                            </div>
                                        )}

                                        {!isHistoryLoading && !historyError && groupedHistory.length > 0 && (
                                            <div className={styles.groupList}>
                                                {groupedHistory.map((group) => (
                                                    <div key={group.key} className={styles.groupSection}>
                                                        <h3 className={styles.groupTitle}>{group.label}</h3>
                                                        <div className={styles.cards}>
                                                            {group.items.map((item) => {
                                                                const isIncoming = item.type === 'topup' || item.type === 'receive';
                                                                const kindClass = isIncoming ? styles.kindReceived : styles.kindSent;
                                                                const dateTimeLine = `${formatDetailsDate(item.createdAt, locale)}, ${formatTime(item.createdAt, locale)}`;
                                                                const amountLine = `${isIncoming ? '+' : '-'}${formatCurrency(item.amount)} ${item.currency || 'UZS'}`;

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

                                                {historyHasMore && (
                                                    <button
                                                        type="button"
                                                        className={styles.loadMoreButton}
                                                        onClick={handleLoadMore}
                                                        disabled={isHistoryLoadingMore}
                                                    >
                                                        {isHistoryLoadingMore && <Loader2 size={16} className={styles.spinner} />}
                                                        <span>
                                                            {isHistoryLoadingMore
                                                                ? (t('wallet_history_loading_more') || 'Loading...')
                                                                : (t('wallet_history_load_more') || 'Load more')}
                                                        </span>
                                                    </button>
                                                )}
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
                                                                const cardDateTimeLine = `${formatDetailsDate(item.timestamp, locale)}, ${formatTime(item.timestamp, locale)}`;

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
                    )}
                </main>

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
                                    <span className={styles.summaryAsset}>UZS</span>
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
                                            id: 'fee',
                                            label: t('transactions_fee') || 'Fee',
                                            value: selectedWalletFeeValue,
                                            hidden: !shouldShowWalletFee,
                                        },
                                        {
                                            id: 'memo',
                                            label: t('transactions_comment') || t('transactions_memo') || 'Comment',
                                            value: selectedWalletMemo,
                                            hidden: !shouldShowWalletMemo,
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
                    drawerProps={nftDetailsSwipeHandlers}
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
                    open={Boolean(drawerMode)}
                    onClose={() => closeDrawer()}
                    title={
                        drawerMode === 'withdraw'
                            ? (t('wallet_withdraw_title') || 'Withdraw')
                            : drawerMode === 'receive'
                                ? (t('wallet_receive_title') || 'Receive')
                                : drawerMode === 'send'
                                    ? (t('wallet_send_title') || 'Send UZS')
                                    : (t('wallet_topup_title') || 'Top up wallet')
                    }
                    closeAriaLabel={t('transactions_close') || 'Close'}
                    backAriaLabel={t('back') || 'Back'}
                    showBackButton={drawerMode === 'send' && sendStep === 'confirm' && !isSendConfirmSucceeded}
                    onBack={handleBackFromSendConfirm}
                    overlayClassName={styles.overlay}
                    drawerClassName={styles.drawer}
                    bodyClassName={styles.drawerBodyPlain}
                >
                    {drawerMode === 'receive' ? (
                        <div className={`${styles.drawerBody} ${styles.receiveBody}`}>
                            <div className={styles.receiveQrFrame}>
                                <div className={styles.receiveQrSurface}>
                                    {copyValue ? (
                                        <QRCode value={copyValue} size={188} bgColor="#ffffff" fgColor="#111111" />
                                    ) : (
                                        <div className={styles.receiveQrPlaceholder}>
                                            {t('wallet_receive_qr_placeholder') || 'Wallet address unavailable'}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className={styles.receiveAddressRow}>
                                <span className={styles.receiveAddress}>{receiveWalletValue}</span>
                                <div className={styles.receiveActions}>
                                    <RoundIconButton
                                        size={34}
                                        className={`${styles.iconButton} ${copiedInDrawer ? styles.iconButtonDone : ''}`}
                                        onClick={handleCopyAddressInDrawer}
                                        disabled={!copyValue}
                                        aria-label={t('wallet_copy') || 'Copy address'}
                                    >
                                        {copiedInDrawer ? <Check size={16} /> : <Copy size={16} />}
                                    </RoundIconButton>
                                    <RoundIconButton
                                        size={34}
                                        className={styles.iconButton}
                                        onClick={handleShareAddress}
                                        disabled={!copyValue}
                                        aria-label={t('wallet_share') || 'Share address'}
                                    >
                                        <IoShareSocial size={16} />
                                    </RoundIconButton>
                                </div>
                            </div>
                        </div>
                    ) : drawerMode === 'send' ? (
                        <div className={styles.drawerBody}>
                            {sendStep === 'input' ? (
                                <>
                                    <RecipientLookupField
                                        recipientType={recipientType}
                                        onRecipientTypeChange={(nextType) => {
                                            setRecipientType(nextType);
                                            setDrawerError('');
                                            haptic.selection();
                                        }}
                                        walletTabLabel={t('wallet') || 'Wallet'}
                                        usernameValue={usernameInput}
                                        walletValue={walletBodyInput}
                                        usernamePlaceholder={t('wallet_send_username_placeholder') || 'username'}
                                        walletPlaceholder={t('wallet_send_wallet_placeholder') || 'X'.repeat(WALLET_FRIENDLY_BODY_LENGTH)}
                                        onUsernameChange={(rawValue) => {
                                            const nextUsername = sanitizeUsernameInput(rawValue);
                                            setUsernameInput(nextUsername);
                                            setRecipientLookup((current) => {
                                                if (!current) {
                                                    return null;
                                                }

                                                const currentUsername = sanitizeUsernameInput(current.username || '');
                                                if (!currentUsername || !nextUsername) {
                                                    return null;
                                                }

                                                return currentUsername.toLowerCase() === nextUsername.toLowerCase()
                                                    ? current
                                                    : null;
                                            });
                                            setDrawerError('');
                                        }}
                                        onWalletChange={(rawValue) => {
                                            const nextWalletBody = sanitizeWalletFriendlyBody(rawValue);
                                            setWalletBodyInput(nextWalletBody);
                                            setDrawerError('');
                                        }}
                                        walletPrefix={WALLET_FRIENDLY_PREFIX}
                                        usernameAvatarUrl={hasExactUsernameMatch ? (recipientLookup?.photoUrl || null) : null}
                                        walletSuggestion={recipientType === 'wallet' && suggestedWallet
                                            ? {
                                                displayName: suggestionDisplayName,
                                                address: suggestedWallet,
                                                photoUrl: recipientLookup?.photoUrl || null,
                                                onSelect: () => {
                                                    setWalletBodyInput(sanitizeWalletFriendlyBody(suggestedWallet));
                                                    setDrawerError('');
                                                    haptic.selection();
                                                },
                                            }
                                            : null}
                                    />

                                    <div className={`${styles.sendField} ${styles.sendAmountField}`}>
                                        <div className={`${styles.sendInputWrap} ${styles.sendAmountInputWrap}`}>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                pattern="[0-9 ]*"
                                                value={amountInput}
                                                onChange={(event) => {
                                                    setSelectedQuick(null);
                                                    setAmountInput(formatAmountInput(event.target.value));
                                                    setDrawerError('');
                                                }}
                                                className={`${styles.sendInput} ${styles.sendAmountInput}`}
                                            />
                                            <span className={styles.sendAmountCurrency}>UZS</span>
                                        </div>
                                    </div>

                                    <div className={styles.sendMeta}>
                                        <div className={styles.sendMetaRow}>
                                            <span>{t('wallet_send_fee_label') || 'Fee'}</span>
                                            <strong>{formatCurrency(WALLET_SEND_FEE)} UZS</strong>
                                        </div>
                                        <div className={styles.sendMetaRow}>
                                            <span>{t('wallet_send_total_label') || 'Total debit'}</span>
                                            <strong>{sendTotalDebit ? `${formatCurrency(sendTotalDebit)} UZS` : '—'}</strong>
                                        </div>
                                    </div>

                                    {drawerError && <p className={styles.drawerError}>{drawerError}</p>}

                                    <div className={styles.continueBar}>
                                        <button
                                            type="button"
                                            className={styles.continueButton}
                                            onClick={handleContinueSend}
                                            disabled={!canContinueSend || isSubmitting}
                                        >
                                            <span>{t('continue') || 'Continue'}</span>
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className={styles.confirmSection}>
                                    <div className={styles.transferSummary}>
                                        <div className={styles.fromTo}>
                                            <span className={styles.fromToLabel}>{t('wallet_send_from_label') || 'From'}</span>
                                            <span className={styles.fromToValue}>@{user?.username || (t('you') || 'you')}</span>
                                        </div>
                                        <ArrowRight size={20} className={styles.arrow} />
                                        <div className={styles.fromTo}>
                                            <span className={styles.fromToLabel}>{t('wallet_send_to_short_label') || 'To'}</span>
                                            <span className={styles.fromToValue}>{sendRecipientDisplay}</span>
                                        </div>
                                    </div>

                                    <DetailsTable
                                        className={styles.confirmInfoTable}
                                        rowClassName={styles.confirmInfoRow}
                                        keyClassName={styles.confirmInfoKey}
                                        valueClassName={styles.confirmInfoValue}
                                        rows={[
                                            {
                                                id: 'amount',
                                                label: t('wallet_amount_label') || 'Amount',
                                                value: parsedAmount ? `${formatCurrency(parsedAmount)} UZS` : '—',
                                            },
                                            {
                                                id: 'fee',
                                                label: t('wallet_send_fee_label') || 'Fee',
                                                value: `${formatCurrency(WALLET_SEND_FEE)} UZS`,
                                            },
                                            {
                                                id: 'total',
                                                label: t('wallet_send_total_label') || 'Total debit',
                                                value: sendTotalDebit ? `${formatCurrency(sendTotalDebit)} UZS` : '—',
                                            },
                                        ]}
                                    />

                                    <div className={styles.memoField}>
                                        <div className={styles.memoInputWrap}>
                                            <textarea
                                                className={styles.memoInput}
                                                value={sendMemoInput}
                                                onChange={(event) => {
                                                    setSendMemoInput(sanitizeSendMemo(event.target.value));
                                                }}
                                                placeholder={t('transfer_memo_placeholder') || 'Optional comment'}
                                                maxLength={SEND_MEMO_MAX_LENGTH}
                                                rows={3}
                                            />
                                            <div className={styles.memoCounterInside}>
                                                <span className={styles.memoCounter}>
                                                    {sendMemoLength}/{SEND_MEMO_MAX_LENGTH}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {drawerError && <p className={styles.drawerError}>{drawerError}</p>}

                                    <div className={styles.swipeConfirm}>
                                        <SwipeConfirmWithSuccess
                                            label={t('transfer_swipe_confirm') || 'Confirm'}
                                            onConfirm={handleApplySend}
                                            isSubmitting={isSubmitting}
                                            isSuccess={isSendConfirmSucceeded}
                                            onSuccessAutoClose={handleSendConfirmAutoClose}
                                            resetKey={`${drawerMode}-${sendStep}-${sendRecipientDisplay}-${parsedAmount ?? 'none'}`}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className={styles.drawerBody}>
                            <p className={styles.drawerHint}>
                                {drawerMode === 'withdraw'
                                    ? (t('wallet_withdraw_hint') || 'Choose amount to withdraw from your wallet balance.')
                                    : (t('wallet_topup_hint') || 'Choose amount to add to your wallet balance.')}
                            </p>

                            <div className={styles.quickGrid}>
                                {QUICK_AMOUNTS.map((value) => (
                                    <button
                                        key={value}
                                        type="button"
                                        className={`${styles.quickButton} ${selectedQuick === value ? styles.quickButtonActive : ''}`}
                                        onClick={() => {
                                            setSelectedQuick(value);
                                            setAmountInput(formatAmountInput(String(value)));
                                            haptic.selection();
                                        }}
                                    >
                                        {formatCurrency(value)} UZS
                                    </button>
                                ))}
                            </div>

                            <label className={styles.amountField}>
                                <span>{t('wallet_amount_label') || 'Amount'}</span>
                                <div className={styles.amountInputWrap}>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9 ]*"
                                        value={amountInput}
                                        onChange={(event) => {
                                            setSelectedQuick(null);
                                            setAmountInput(formatAmountInput(event.target.value));
                                        }}
                                        placeholder="10 000"
                                    />
                                    <span>UZS</span>
                                </div>
                            </label>

                            {drawerError && <p className={styles.drawerError}>{drawerError}</p>}

                            <button
                                type="button"
                                className={styles.submitButton}
                                onClick={handleApplyBalanceMutation}
                                disabled={isSubmitting}
                            >
                                {isSubmitting && <Loader2 size={16} className={styles.spinner} />}
                                <span>
                                    {drawerMode === 'withdraw'
                                        ? (t('wallet_withdraw_apply') || 'Withdraw now')
                                        : (t('wallet_topup_apply') || 'Top up now')}
                                </span>
                            </button>
                        </div>
                    )}
                </BottomDrawer>
            </div>
        </>
    );
}
