'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ArrowDownLeft,
    ArrowDownToLine,
    ArrowUpFromLine,
    ArrowUpRight,
    Check,
    Copy,
    Loader2,
    QrCode,
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
    type: 'topup' | 'withdraw';
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

type DrawerMode = 'topup' | 'withdraw' | 'receive' | null;

const QUICK_AMOUNTS = [5000, 10000, 25000, 50000, 100000];
const HISTORY_PAGE_SIZE = 20;

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

    const [copied, setCopied] = useState(false);
    const [copiedInDrawer, setCopiedInDrawer] = useState(false);

    const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
    const [amountInput, setAmountInput] = useState('');
    const [selectedQuick, setSelectedQuick] = useState<number | null>(null);
    const [drawerError, setDrawerError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

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

    const shortWalletValue = useMemo(() => {
        const raw = copyValue.toUpperCase();
        if (!raw) {
            return '—';
        }

        if (raw.length <= 14) {
            return raw;
        }

        return `${raw.slice(0, 8)}...${raw.slice(-6)}`;
    }, [copyValue]);

    const receiveWalletValue = useMemo(() => {
        const raw = copyValue.toUpperCase();
        if (!raw) {
            return 'LV-......';
        }

        const suffix = raw.slice(-6).padStart(6, '.');
        return `LV-...${suffix}`;
    }, [copyValue]);

    const parsedAmount = useMemo(() => {
        const normalized = amountInput.trim();
        if (!normalized) {
            return null;
        }

        const parsed = Number.parseInt(normalized, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
            return null;
        }

        return parsed;
    }, [amountInput]);

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

        if (mode === 'receive') {
            setSelectedQuick(null);
            setAmountInput('');
            return;
        }

        const defaultAmount = QUICK_AMOUNTS[1];
        setSelectedQuick(defaultAmount);
        setAmountInput(String(defaultAmount));
    };

    const closeDrawer = (force = false) => {
        if (isSubmitting && !force) {
            return;
        }

        setDrawerMode(null);
        setDrawerError('');
        setAmountInput('');
        setSelectedQuick(null);
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

    const handleCopyAddress = useCallback(async () => {
        if (!copyValue) {
            return;
        }

        haptic.impact('light');

        try {
            await writeToClipboard(copyValue);
            setCopied(true);
            haptic.success();
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            haptic.error();
        }
    }, [copyValue, haptic, writeToClipboard]);

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

    const handleApply = async () => {
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

    const handleLoadMore = () => {
        if (!historyHasMore || !historyCursor || isHistoryLoadingMore) {
            return;
        }

        haptic.selection();
        void loadHistory({ cursor: historyCursor, append: true });
    };

    const getOperationTitle = (type: WalletHistoryItem['type']) => {
        return type === 'topup'
            ? (t('wallet_history_operation_topup') || 'Top up')
            : (t('wallet_history_operation_withdraw') || 'Withdraw');
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
                                        className={`${styles.actionButton} ${styles.actionPrimary}`}
                                        onClick={() => openDrawer('topup')}
                                    >
                                        <ArrowDownToLine size={18} />
                                        <span>{t('wallet_topup') || 'Top up'}</span>
                                    </button>

                                    <button
                                        type="button"
                                        className={`${styles.actionButton} ${styles.actionSecondary}`}
                                        onClick={() => openDrawer('withdraw')}
                                        disabled={wallet.balance <= 0}
                                    >
                                        <ArrowUpFromLine size={18} />
                                        <span>{t('wallet_withdraw') || 'Withdraw'}</span>
                                    </button>

                                    <button
                                        type="button"
                                        className={`${styles.actionButton} ${styles.actionSecondary}`}
                                        onClick={() => openDrawer('receive')}
                                        disabled={!copyValue}
                                    >
                                        <QrCode size={18} />
                                        <span>{t('wallet_receive') || 'Receive'}</span>
                                    </button>
                                </div>
                            </section>

                            <section className={styles.card}>
                                <div className={styles.infoHead}>
                                    <span className={styles.infoLabel}>{t('wallet_address_label') || 'Wallet address'}</span>
                                    <span className={styles.addressPreview}>{shortWalletValue}</span>
                                </div>

                                <code className={styles.addressValue}>{copyValue || '—'}</code>

                                <button
                                    type="button"
                                    className={`${styles.copyButton} ${copied ? styles.copyButtonDone : ''}`}
                                    onClick={handleCopyAddress}
                                    disabled={!copyValue}
                                >
                                    {copied ? <Check size={16} /> : <Copy size={16} />}
                                    <span>{copied ? (t('wallet_copied') || 'Copied') : (t('wallet_copy') || 'Copy address')}</span>
                                </button>
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
                                                        const isTopup = item.type === 'topup';
                                                        const kindClass = isTopup ? styles.kindReceived : styles.kindSent;
                                                        const dateTimeLine = `${formatDetailsDate(item.createdAt, locale)}, ${formatTime(item.createdAt, locale)}`;
                                                        const amountLine = `${isTopup ? '+' : '-'}${formatCurrency(item.amount)} ${item.currency || 'UZS'}`;

                                                        return (
                                                            <article key={item.id} className={styles.cardHistoryItem}>
                                                                <div className={styles.cardRow}>
                                                                    <div className={styles.summaryLeft}>
                                                                        <span className={`${styles.kindIcon} ${kindClass}`}>
                                                                            {isTopup ? <ArrowDownLeft size={22} /> : <ArrowUpRight size={22} />}
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
                                                setAmountInput(String(value));
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
                                            type="number"
                                            min={1}
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            value={amountInput}
                                            onChange={(event) => {
                                                setSelectedQuick(null);
                                                setAmountInput(event.target.value.replace(/[^0-9]/g, ''));
                                            }}
                                            placeholder="10000"
                                        />
                                        <span>UZS</span>
                                    </div>
                                </label>

                                {drawerError && <p className={styles.drawerError}>{drawerError}</p>}

                                <button
                                    type="button"
                                    className={styles.submitButton}
                                    onClick={handleApply}
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
