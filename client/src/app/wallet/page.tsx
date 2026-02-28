'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowDownLeft,
    ArrowDownToLine,
    ArrowUpFromLine,
    ArrowUpRight,
    Check,
    Copy,
    Loader2,
    QrCode,
    Send,
    Share2,
    Wallet as WalletIcon,
    X,
} from 'lucide-react';
import QRCode from 'react-qr-code';

import { TelegramBackButton } from '@/components/ui/TelegramBackButton';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/context/LanguageContext';
import { useTelegram } from '@/lib/context/TelegramContext';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';

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

type DrawerMode = 'topup' | 'withdraw' | 'receive' | 'send' | null;
type SendRecipientType = 'username' | 'wallet';

const QUICK_AMOUNTS = [5000, 10000, 25000, 50000, 100000];
const HISTORY_PAGE_SIZE = 20;
const WALLET_SEND_FEE = 71;
const WALLET_FRIENDLY_BODY_LENGTH = 12;
const TELEGRAM_USERNAME_MAX_LENGTH = 32;
const SEND_LOOKUP_DEBOUNCE_MS = 420;
const MAX_AMOUNT_INPUT_DIGITS = 11;

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

function sanitizeFriendlyBody(value: string): string {
    return value
        .trim()
        .replace(/^LV-/i, '')
        .replace(/^UZ-/i, '')
        .replace(/[^a-zA-Z0-9_]/g, '')
        .toUpperCase()
        .slice(0, WALLET_FRIENDLY_BODY_LENGTH);
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

function getRecipientFallbackLetter(recipient: RecipientLookupResult | null): string {
    if (!recipient) {
        return 'U';
    }

    const firstName = (recipient.firstName || '').trim();
    if (firstName) {
        return firstName.slice(0, 1).toUpperCase();
    }

    const username = sanitizeUsernameInput(recipient.username || '');
    if (username) {
        return username.slice(0, 1).toUpperCase();
    }

    return 'U';
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

    const [copiedInDrawer, setCopiedInDrawer] = useState(false);

    const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
    const [amountInput, setAmountInput] = useState('');
    const [selectedQuick, setSelectedQuick] = useState<number | null>(null);
    const [drawerError, setDrawerError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [recipientType, setRecipientType] = useState<SendRecipientType>('username');
    const [usernameInput, setUsernameInput] = useState('');
    const [walletBodyInput, setWalletBodyInput] = useState('');
    const [recipientLookup, setRecipientLookup] = useState<RecipientLookupResult | null>(null);
    const [isRecipientLookupLoading, setIsRecipientLookupLoading] = useState(false);
    const lookupSeqRef = useRef(0);

    useBodyScrollLock(Boolean(drawerMode));

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

    useEffect(() => {
        void loadWallet();
        void loadHistory();
    }, [loadHistory, loadWallet]);

    const copyValue = useMemo(() => {
        const friendly = (wallet?.friendlyAddress || user?.walletFriendly || '').trim();
        if (friendly) {
            return friendly;
        }

        return (wallet?.address || user?.walletAddress || '').trim();
    }, [wallet?.address, wallet?.friendlyAddress, user?.walletAddress, user?.walletFriendly]);

    const receiveWalletValue = useMemo(() => {
        const raw = copyValue.toUpperCase();
        if (!raw) {
            return 'LV-......';
        }

        const suffix = raw.slice(-6).padStart(6, '.');
        return `LV-...${suffix}`;
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
    const normalizedWalletBody = useMemo(() => sanitizeFriendlyBody(walletBodyInput), [walletBodyInput]);
    const resolvedLookupUsername = useMemo(
        () => sanitizeUsernameInput(recipientLookup?.username || ''),
        [recipientLookup?.username],
    );
    const resolvedLookupWalletBody = useMemo(
        () => sanitizeFriendlyBody(recipientLookup?.walletFriendly || ''),
        [recipientLookup?.walletFriendly],
    );
    const hasExactUsernameMatch = useMemo(() => {
        if (!normalizedUsername || !resolvedLookupUsername) {
            return false;
        }

        return normalizedUsername.toLowerCase() === resolvedLookupUsername.toLowerCase();
    }, [normalizedUsername, resolvedLookupUsername]);
    const hasExactWalletMatch = useMemo(() => {
        if (!normalizedWalletBody || !resolvedLookupWalletBody) {
            return false;
        }

        return normalizedWalletBody === resolvedLookupWalletBody;
    }, [normalizedWalletBody, resolvedLookupWalletBody]);
    const recipientPreviewName = useMemo(() => {
        if (hasExactUsernameMatch && resolvedLookupUsername) {
            return `@${resolvedLookupUsername}`;
        }

        const firstName = (recipientLookup?.firstName || '').trim();
        if (firstName) {
            return firstName;
        }

        if (resolvedLookupUsername) {
            return `@${resolvedLookupUsername}`;
        }

        return t('wallet_send_to_label') || 'Recipient';
    }, [hasExactUsernameMatch, recipientLookup?.firstName, resolvedLookupUsername, t]);
    const recipientPreviewWallet = useMemo(() => {
        if (resolvedLookupWalletBody) {
            return `LV-${resolvedLookupWalletBody}`;
        }

        return '';
    }, [resolvedLookupWalletBody]);
    const recipientFallbackLetter = useMemo(
        () => getRecipientFallbackLetter(recipientLookup),
        [recipientLookup],
    );

    useEffect(() => {
        if (drawerMode !== 'send') {
            lookupSeqRef.current += 1;
            setRecipientLookup(null);
            setIsRecipientLookupLoading(false);
            return;
        }

        if (recipientType === 'username') {
            const usernameLookup = normalizedUsername.toLowerCase();

            if (usernameLookup.length < 2) {
                lookupSeqRef.current += 1;
                setRecipientLookup(null);
                setIsRecipientLookupLoading(false);
                return;
            }

            const lookupSeq = ++lookupSeqRef.current;
            const timeoutId = window.setTimeout(async () => {
                setIsRecipientLookupLoading(true);

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
                } finally {
                    if (lookupSeqRef.current === lookupSeq) {
                        setIsRecipientLookupLoading(false);
                    }
                }
            }, SEND_LOOKUP_DEBOUNCE_MS);

            return () => {
                window.clearTimeout(timeoutId);
            };
        }

        if (normalizedWalletBody.length < 3) {
            lookupSeqRef.current += 1;
            setRecipientLookup(null);
            setIsRecipientLookupLoading(false);
            return;
        }

        const lookupSeq = ++lookupSeqRef.current;
        const timeoutId = window.setTimeout(async () => {
            setIsRecipientLookupLoading(true);

            try {
                const response = await api.wallet.findRecipient(
                    { wallet: `LV-${normalizedWalletBody}` },
                    webApp?.initData || undefined,
                );

                if (lookupSeqRef.current !== lookupSeq) {
                    return;
                }

                const nextRecipient = response?.recipient || null;
                const nextWalletBody = sanitizeFriendlyBody(nextRecipient?.walletFriendly || '');

                if (nextRecipient && nextWalletBody === normalizedWalletBody) {
                    setRecipientLookup(nextRecipient);
                } else {
                    setRecipientLookup(null);
                }
            } catch {
                if (lookupSeqRef.current === lookupSeq) {
                    setRecipientLookup(null);
                }
            } finally {
                if (lookupSeqRef.current === lookupSeq) {
                    setIsRecipientLookupLoading(false);
                }
            }
        }, SEND_LOOKUP_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [drawerMode, normalizedUsername, normalizedWalletBody, recipientType, webApp?.initData]);

    const sendTotalDebit = useMemo(() => {
        if (!parsedAmount) {
            return null;
        }

        return parsedAmount + WALLET_SEND_FEE;
    }, [parsedAmount]);

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

    const openDrawer = (mode: Exclude<DrawerMode, null>) => {
        haptic.impact('light');
        setDrawerMode(mode);
        setDrawerError('');
        setCopiedInDrawer(false);
        setRecipientLookup(null);
        setIsRecipientLookupLoading(false);

        if (mode === 'receive') {
            setSelectedQuick(null);
            setAmountInput('');
            return;
        }

        if (mode === 'send') {
            setSelectedQuick(null);
            setAmountInput('');
            setRecipientType('username');
            setUsernameInput('');
            setWalletBodyInput('');
            return;
        }

        const defaultAmount = QUICK_AMOUNTS[1];
        setSelectedQuick(defaultAmount);
        setAmountInput(formatAmountInput(String(defaultAmount)));
    };

    const closeDrawer = (force = false) => {
        if (isSubmitting && !force) {
            return;
        }

        setDrawerMode(null);
        setDrawerError('');
        setAmountInput('');
        setSelectedQuick(null);
        setRecipientType('username');
        setUsernameInput('');
        setWalletBodyInput('');
        setRecipientLookup(null);
        setIsRecipientLookupLoading(false);
    };

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
            closeDrawer(true);
        } catch (applyError) {
            setDrawerError(safeErrorMessage(applyError));
            haptic.error();
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleApplySend = async () => {
        if (drawerMode !== 'send') {
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

        const recipientByUsername = recipientType === 'username' ? normalizedUsername : '';
        const recipientByWallet = recipientType === 'wallet' ? normalizedWalletBody : '';

        if (!recipientByUsername && !recipientByWallet) {
            setDrawerError(t('recipient_required') || 'Recipient is required');
            haptic.error();
            return;
        }

        const requiredBalance = parsedAmount + WALLET_SEND_FEE;
        if (requiredBalance > (wallet?.balance || 0)) {
            const fallback = `Need ${formatCurrency(requiredBalance)} UZS`;
            setDrawerError(t('wallet_send_insufficient') || fallback);
            haptic.error();
            return;
        }

        setIsSubmitting(true);
        setDrawerError('');

        try {
            await api.wallet.send({
                amount: parsedAmount,
                ...(recipientByUsername
                    ? { toUsername: recipientByUsername }
                    : { toAddress: `LV-${recipientByWallet}` }),
            });

            await Promise.all([
                loadWallet(),
                loadHistory({ cursor: null, append: false }),
            ]);

            haptic.success();
            closeDrawer(true);
        } catch (applyError) {
            setDrawerError(safeErrorMessage(applyError));
            haptic.error();
        } finally {
            setIsSubmitting(false);
        }
    };

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
                    {isLoading && (
                        <section className={styles.card}>
                            <p className={styles.statusText}>{t('loading') || 'Loading...'}</p>
                        </section>
                    )}

                    {!isLoading && error && (
                        <section className={styles.card}>
                            <p className={styles.errorText}>{error}</p>
                        </section>
                    )}

                    {!isLoading && !error && wallet && (
                        <>
                            <section className={`${styles.card} ${styles.balanceCard}`}>
                                <div className={styles.balanceBadge}>
                                    <WalletIcon size={16} />
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
                                    >
                                        <span className={`${styles.actionIcon} ${styles.actionIconTopup}`}>
                                            <ArrowDownToLine size={18} />
                                        </span>
                                        <span className={styles.actionLabel}>{t('wallet_topup') || 'Top up'}</span>
                                    </button>

                                    <button
                                        type="button"
                                        className={styles.actionTile}
                                        onClick={() => openDrawer('withdraw')}
                                        disabled={wallet.balance <= 0}
                                    >
                                        <span className={`${styles.actionIcon} ${styles.actionIconWithdraw}`}>
                                            <ArrowUpFromLine size={18} />
                                        </span>
                                        <span className={styles.actionLabel}>{t('wallet_withdraw') || 'Withdraw'}</span>
                                    </button>

                                    <button
                                        type="button"
                                        className={styles.actionTile}
                                        onClick={() => openDrawer('receive')}
                                        disabled={!copyValue}
                                    >
                                        <span className={`${styles.actionIcon} ${styles.actionIconReceive}`}>
                                            <QrCode size={18} />
                                        </span>
                                        <span className={styles.actionLabel}>{t('wallet_receive') || 'Receive'}</span>
                                    </button>

                                    <button
                                        type="button"
                                        className={styles.actionTile}
                                        onClick={() => openDrawer('send')}
                                        disabled={wallet.balance <= WALLET_SEND_FEE}
                                    >
                                        <span className={`${styles.actionIcon} ${styles.actionIconSend}`}>
                                            <Send size={18} />
                                        </span>
                                        <span className={styles.actionLabel}>{t('wallet_send') || t('send') || 'Send'}</span>
                                    </button>
                                </div>
                            </section>

                            <section className={styles.historySection}>
                                {isHistoryLoading && (
                                    <div className={styles.skeletonList}>
                                        {[0, 1, 2, 3].map((index) => (
                                            <div key={index} className={styles.skeletonItem}></div>
                                        ))}
                                    </div>
                                )}

                                {!isHistoryLoading && historyError && (
                                    <div className={styles.errorState}>{historyError}</div>
                                )}

                                {!isHistoryLoading && !historyError && groupedHistory.length === 0 && (
                                    <div className={styles.emptyState}>
                                        {t('wallet_history_empty') || 'No wallet operations yet'}
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
                                                            <article key={item.id} className={styles.cardHistoryItem}>
                                                                <div className={styles.cardRow}>
                                                                    <div className={styles.summaryLeft}>
                                                                        <span className={`${styles.kindIcon} ${kindClass}`}>
                                                                            {isIncoming ? <ArrowDownLeft size={22} /> : <ArrowUpRight size={22} />}
                                                                        </span>
                                                                        <div className={styles.summaryText}>
                                                                            <span className={styles.summaryDirection}>{getOperationTitle(item.type)}</span>
                                                                            <span className={styles.summaryAddress}>{amountLine}</span>
                                                                        </div>
                                                                    </div>
                                                                    <div className={styles.summaryRight}>
                                                                        <span className={styles.summaryAsset}>{getStatusLabel(item.status)}</span>
                                                                        <span className={styles.summaryDate}>{dateTimeLine}</span>
                                                                    </div>
                                                                </div>
                                                            </article>
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
                            </section>
                        </>
                    )}
                </main>

                <div
                    className={`${styles.overlay} ${drawerMode ? styles.overlayVisible : ''}`}
                    onClick={() => closeDrawer()}
                    aria-hidden={!drawerMode}
                >
                    <section
                        className={`${styles.drawer} ${drawerMode ? styles.drawerOpen : ''}`}
                        onClick={(event) => event.stopPropagation()}
                        aria-hidden={!drawerMode}
                    >
                        <div className={styles.dragHandle} />

                        <div className={styles.drawerHeader}>
                            <h3>
                                {drawerMode === 'withdraw'
                                    ? (t('wallet_withdraw_title') || 'Withdraw')
                                    : drawerMode === 'receive'
                                        ? (t('wallet_receive_title') || 'Receive')
                                        : drawerMode === 'send'
                                            ? (t('wallet_send_title') || 'Send UZS')
                                            : (t('wallet_topup_title') || 'Top up wallet')}
                            </h3>
                            <button type="button" className={styles.closeButton} onClick={() => closeDrawer()}>
                                <X size={16} />
                            </button>
                        </div>

                        {drawerMode === 'receive' ? (
                            <div className={`${styles.drawerBody} ${styles.receiveBody}`}>
                                <p className={styles.drawerHint}>
                                    {t('wallet_receive_hint') || 'Scan this QR code to receive assets on your wallet.'}
                                </p>

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
                                        <button
                                            type="button"
                                            className={`${styles.iconButton} ${copiedInDrawer ? styles.iconButtonDone : ''}`}
                                            onClick={handleCopyAddressInDrawer}
                                            disabled={!copyValue}
                                            aria-label={t('wallet_copy') || 'Copy address'}
                                        >
                                            {copiedInDrawer ? <Check size={16} /> : <Copy size={16} />}
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.iconButton}
                                            onClick={handleShareAddress}
                                            disabled={!copyValue}
                                            aria-label={t('wallet_share') || 'Share address'}
                                        >
                                            <Share2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : drawerMode === 'send' ? (
                            <div className={styles.drawerBody}>
                                <div className={styles.sendTabs}>
                                    <button
                                        type="button"
                                        className={`${styles.sendTab} ${recipientType === 'username' ? styles.sendTabActive : ''}`}
                                        onClick={() => {
                                            setRecipientType('username');
                                            setRecipientLookup(null);
                                            setDrawerError('');
                                            haptic.selection();
                                        }}
                                    >
                                        @username
                                    </button>
                                    <button
                                        type="button"
                                        className={`${styles.sendTab} ${recipientType === 'wallet' ? styles.sendTabActive : ''}`}
                                        onClick={() => {
                                            setRecipientType('wallet');
                                            setRecipientLookup(null);
                                            setDrawerError('');
                                            haptic.selection();
                                        }}
                                    >
                                        {t('wallet') || 'Wallet'}
                                    </button>
                                </div>

                                <div className={styles.sendField}>
                                    <div className={styles.sendInputWrap}>
                                        {recipientType === 'username' ? (
                                            <span className={styles.sendPrefixSlot}>
                                                {hasExactUsernameMatch ? (
                                                    recipientLookup?.photoUrl ? (
                                                        <img
                                                            src={recipientLookup.photoUrl}
                                                            alt=""
                                                            className={styles.sendPrefixAvatar}
                                                            loading="lazy"
                                                            referrerPolicy="no-referrer"
                                                        />
                                                    ) : (
                                                        <span className={styles.sendPrefixAvatarFallback}>
                                                            {recipientFallbackLetter}
                                                        </span>
                                                    )
                                                ) : (
                                                    <span className={styles.sendPrefix}>@</span>
                                                )}
                                                {isRecipientLookupLoading && (
                                                    <Loader2 size={10} className={styles.sendPrefixSpinner} />
                                                )}
                                            </span>
                                        ) : (
                                            <span className={styles.sendPrefix}>LV-</span>
                                        )}
                                        <input
                                            type="text"
                                            className={styles.sendInput}
                                            value={recipientType === 'username' ? usernameInput : walletBodyInput}
                                            placeholder={
                                                recipientType === 'username'
                                                    ? (t('wallet_send_username_placeholder') || 'username')
                                                    : (t('wallet_send_wallet_placeholder') || 'XXXXXXXXXXXX')
                                            }
                                            onChange={(event) => {
                                                if (recipientType === 'username') {
                                                    const nextUsername = sanitizeUsernameInput(event.target.value);
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
                                                } else {
                                                    const nextWalletBody = sanitizeFriendlyBody(event.target.value);
                                                    setWalletBodyInput(nextWalletBody);
                                                    setRecipientLookup((current) => {
                                                        if (!current) {
                                                            return null;
                                                        }

                                                        const currentWalletBody = sanitizeFriendlyBody(current.walletFriendly || '');
                                                        if (!currentWalletBody || !nextWalletBody) {
                                                            return null;
                                                        }

                                                        return currentWalletBody === nextWalletBody
                                                            ? current
                                                            : null;
                                                    });
                                                }
                                                setDrawerError('');
                                            }}
                                        />
                                    </div>
                                </div>

                                {recipientLookup && (recipientType === 'username' ? hasExactUsernameMatch : hasExactWalletMatch) && (
                                    <div className={styles.sendRecipientPreview}>
                                        <span className={styles.sendRecipientAvatarWrap}>
                                            {recipientLookup.photoUrl ? (
                                                <img
                                                    src={recipientLookup.photoUrl}
                                                    alt=""
                                                    className={styles.sendRecipientAvatar}
                                                    loading="lazy"
                                                    referrerPolicy="no-referrer"
                                                />
                                            ) : (
                                                <span className={styles.sendRecipientAvatarFallback}>{recipientFallbackLetter}</span>
                                            )}
                                        </span>
                                        <span className={styles.sendRecipientMeta}>
                                            <span className={styles.sendRecipientName}>{recipientPreviewName}</span>
                                            <span className={styles.sendRecipientWallet}>
                                                {recipientPreviewWallet || `ID: ${recipientLookup.id}`}
                                            </span>
                                        </span>
                                    </div>
                                )}

                                <div className={styles.amountField}>
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

                                <button
                                    type="button"
                                    className={styles.submitButton}
                                    onClick={handleApplySend}
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting && <Loader2 size={16} className={styles.spinner} />}
                                    <span>{t('wallet_send_apply') || 'Send now'}</span>
                                </button>
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
                    </section>
                </div>
            </div>
        </>
    );
}
