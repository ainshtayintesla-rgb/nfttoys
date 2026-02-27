'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, Copy, Loader2, Wallet as WalletIcon, X } from 'lucide-react';

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

type DrawerMode = 'topup' | 'withdraw' | null;

const QUICK_AMOUNTS = [5000, 10000, 25000, 50000, 100000];

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

export default function WalletPage() {
    const { t, locale } = useLanguage();
    const { user, authUser, isAuthenticated, haptic } = useTelegram();

    const [wallet, setWallet] = useState<WalletInfo | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [copied, setCopied] = useState(false);

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

    useEffect(() => {
        void loadWallet();
    }, [loadWallet]);

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

    const openDrawer = (mode: Exclude<DrawerMode, null>) => {
        haptic.impact('light');
        setDrawerMode(mode);
        setDrawerError('');
        const defaultAmount = QUICK_AMOUNTS[1];
        setSelectedQuick(defaultAmount);
        setAmountInput(String(defaultAmount));
    };

    const closeDrawer = () => {
        if (isSubmitting) {
            return;
        }

        setDrawerMode(null);
        setDrawerError('');
        setAmountInput('');
        setSelectedQuick(null);
    };

    const handleCopyAddress = async () => {
        if (!copyValue) {
            return;
        }

        haptic.impact('light');

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(copyValue);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = copyValue;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                textarea.style.top = '-9999px';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }

            setCopied(true);
            haptic.success();
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            haptic.error();
        }
    };

    const handleApply = async () => {
        if (!drawerMode || isSubmitting) {
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

            await loadWallet();
            haptic.success();
            closeDrawer();
        } catch (applyError) {
            setDrawerError(safeErrorMessage(applyError));
            haptic.error();
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            <TelegramBackButton href="/profile" />

            <div className={styles.container}>
                <main className={styles.main}>
                    <header className={styles.header}>
                        <h1>{t('wallet')}</h1>
                        <p>{t('wallet_page_subtitle') || 'Manage your UZS balance and wallet address.'}</p>
                    </header>

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
                        </>
                    )}
                </main>

                <div
                    className={`${styles.overlay} ${drawerMode ? styles.overlayVisible : ''}`}
                    onClick={closeDrawer}
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
                                    : (t('wallet_topup_title') || 'Top up wallet')}
                            </h3>
                            <button type="button" className={styles.closeButton} onClick={closeDrawer}>
                                <X size={16} />
                            </button>
                        </div>

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
                    </section>
                </div>
            </div>
        </>
    );
}
