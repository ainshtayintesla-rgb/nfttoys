'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, UserRound, Wallet } from 'lucide-react';

import { BottomDrawer } from '@/components/ui/BottomDrawer';
import { Button } from '@/components/ui/Button';
import { DetailsTable } from '@/components/ui/DetailsTable';
import { RecipientLookupField, type RecipientLookupType } from '@/components/ui/RecipientLookupField';
import { SwipeConfirmAction } from '@/components/ui/SwipeConfirmAction';
import { api, type AdminWalletLookupTarget } from '@/lib/api';
import { useLanguage } from '@/lib/context/LanguageContext';
import { useTelegram } from '@/lib/context/TelegramContext';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';

import styles from './BalanceTopupTab.module.css';

const TELEGRAM_USERNAME_MAX_LENGTH = 32;
const WALLET_FRIENDLY_BODY_LENGTH = 12;
const LOOKUP_DEBOUNCE_MS = 320;
const MAX_AMOUNT_INPUT_DIGITS = 10;
const QUICK_AMOUNTS = [1000, 5000, 10_000, 50_000, 100_000] as const;

interface ConfirmTopupPayload {
    amount: number;
    sourceType: RecipientLookupType;
    target: AdminWalletLookupTarget;
}

function sanitizeUsernameInput(value: string): string {
    return value
        .trim()
        .replace(/^@+/, '')
        .replace(/[^a-zA-Z0-9_]/g, '')
        .slice(0, TELEGRAM_USERNAME_MAX_LENGTH);
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

function formatAmountValue(value: number): string {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function safeErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    return '';
}

function resolveTargetDisplayName(target: AdminWalletLookupTarget | null, fallback: string): string {
    if (!target?.user) {
        return fallback;
    }

    const username = sanitizeUsernameInput(target.user.username || '');
    if (username) {
        return `@${username}`;
    }

    const firstName = (target.user.firstName || '').trim();
    if (firstName) {
        return firstName;
    }

    return fallback;
}

export function BalanceTopupTab() {
    const { t } = useLanguage();
    const { haptic } = useTelegram();

    const [recipientType, setRecipientType] = useState<RecipientLookupType>('username');
    const [usernameInput, setUsernameInput] = useState('');
    const [walletBodyInput, setWalletBodyInput] = useState('');

    const [usernameTarget, setUsernameTarget] = useState<AdminWalletLookupTarget | null>(null);
    const [walletTarget, setWalletTarget] = useState<AdminWalletLookupTarget | null>(null);
    const [isUsernameLookupLoading, setIsUsernameLookupLoading] = useState(false);
    const [isWalletLookupLoading, setIsWalletLookupLoading] = useState(false);

    const [amountInput, setAmountInput] = useState('');
    const [selectedQuickAmount, setSelectedQuickAmount] = useState<number | null>(null);

    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [confirmPayload, setConfirmPayload] = useState<ConfirmTopupPayload | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const usernameLookupSeqRef = useRef(0);
    const walletLookupSeqRef = useRef(0);

    useBodyScrollLock(isConfirmOpen);

    const normalizedUsername = useMemo(() => sanitizeUsernameInput(usernameInput), [usernameInput]);
    const normalizedWalletBody = useMemo(() => sanitizeFriendlyBody(walletBodyInput), [walletBodyInput]);
    const normalizedWalletFriendly = useMemo(() => (
        normalizedWalletBody ? `LV-${normalizedWalletBody}` : ''
    ), [normalizedWalletBody]);

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

    const lookupTarget = useCallback(async (params: { username?: string; wallet?: string }) => {
        const response = await api.admin.lookupWalletRecipient(params);
        return response?.target || null;
    }, []);

    const resolvedLookupUsername = useMemo(
        () => sanitizeUsernameInput(usernameTarget?.user?.username || ''),
        [usernameTarget?.user?.username],
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

        const source = sanitizeFriendlyBody(usernameTarget?.walletFriendly || '');
        if (!source) {
            return '';
        }

        return `LV-${source}`;
    }, [hasExactUsernameMatch, usernameTarget?.walletFriendly]);

    const usernameDisplayName = useMemo(() => (
        resolveTargetDisplayName(usernameTarget, t('wallet_send_to_label') || 'Recipient')
    ), [t, usernameTarget]);

    useEffect(() => {
        if (recipientType !== 'username') {
            usernameLookupSeqRef.current += 1;
            setIsUsernameLookupLoading(false);
            return;
        }

        if (normalizedUsername.length < 2) {
            usernameLookupSeqRef.current += 1;
            setUsernameTarget(null);
            setIsUsernameLookupLoading(false);
            return;
        }

        const lookupSeq = ++usernameLookupSeqRef.current;
        setIsUsernameLookupLoading(true);

        const timeoutId = window.setTimeout(async () => {
            try {
                const target = await lookupTarget({ username: normalizedUsername });
                if (usernameLookupSeqRef.current !== lookupSeq) {
                    return;
                }

                const targetUsername = sanitizeUsernameInput(target?.user?.username || '');
                if (target && targetUsername && targetUsername.toLowerCase() === normalizedUsername.toLowerCase()) {
                    setUsernameTarget(target);
                } else {
                    setUsernameTarget(null);
                }
            } catch {
                if (usernameLookupSeqRef.current === lookupSeq) {
                    setUsernameTarget(null);
                }
            } finally {
                if (usernameLookupSeqRef.current === lookupSeq) {
                    setIsUsernameLookupLoading(false);
                }
            }
        }, LOOKUP_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [lookupTarget, normalizedUsername, recipientType]);

    useEffect(() => {
        if (recipientType !== 'wallet') {
            walletLookupSeqRef.current += 1;
            setIsWalletLookupLoading(false);
            return;
        }

        if (!normalizedWalletFriendly || normalizedWalletBody.length < 4) {
            walletLookupSeqRef.current += 1;
            setWalletTarget(null);
            setIsWalletLookupLoading(false);
            return;
        }

        const lookupSeq = ++walletLookupSeqRef.current;
        setIsWalletLookupLoading(true);

        const timeoutId = window.setTimeout(async () => {
            try {
                const target = await lookupTarget({ wallet: normalizedWalletFriendly });
                if (walletLookupSeqRef.current !== lookupSeq) {
                    return;
                }

                setWalletTarget(target);
            } catch {
                if (walletLookupSeqRef.current === lookupSeq) {
                    setWalletTarget(null);
                }
            } finally {
                if (walletLookupSeqRef.current === lookupSeq) {
                    setIsWalletLookupLoading(false);
                }
            }
        }, LOOKUP_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [lookupTarget, normalizedWalletBody.length, normalizedWalletFriendly, recipientType]);

    const canContinue = Boolean(
        parsedAmount
        && (recipientType === 'username' ? hasExactUsernameMatch : Boolean(walletTarget)),
    );

    const handleContinue = async () => {
        setError('');
        setSuccess('');

        if (!parsedAmount) {
            setError(t('admin_topup_invalid_amount') || 'Enter valid amount');
            return;
        }

        let nextTarget: AdminWalletLookupTarget | null = null;

        if (recipientType === 'username') {
            if (!hasExactUsernameMatch || !usernameTarget) {
                setError(t('admin_topup_username_not_found') || 'User not found');
                return;
            }

            nextTarget = usernameTarget;
        } else {
            if (!normalizedWalletFriendly) {
                setError(t('admin_topup_wallet_not_found') || 'Wallet not found');
                return;
            }

            nextTarget = walletTarget;

            if (!nextTarget || nextTarget.walletFriendly.toUpperCase() !== normalizedWalletFriendly.toUpperCase()) {
                try {
                    nextTarget = await lookupTarget({ wallet: normalizedWalletFriendly });
                    setWalletTarget(nextTarget);
                } catch {
                    nextTarget = null;
                }
            }

            if (!nextTarget) {
                setError(t('admin_topup_wallet_not_found') || 'Wallet not found');
                return;
            }
        }

        setConfirmPayload({
            amount: parsedAmount,
            sourceType: recipientType,
            target: nextTarget,
        });
        setIsConfirmOpen(true);
    };

    const handleConfirmTopup = async () => {
        if (!confirmPayload || isSubmitting) {
            return;
        }

        setIsSubmitting(true);
        setError('');
        setSuccess('');

        try {
            const response = await api.admin.topupWallet({
                amount: confirmPayload.amount,
                wallet: confirmPayload.target.walletFriendly,
            });

            const resolvedTarget = response?.target || confirmPayload.target;

            setWalletBodyInput(sanitizeFriendlyBody(resolvedTarget.walletFriendly));
            setWalletTarget(resolvedTarget);
            setIsConfirmOpen(false);
            setConfirmPayload(null);
            setAmountInput('');
            setSelectedQuickAmount(null);
            setSuccess(`${t('admin_topup_success') || 'Balance topped up'}: ${resolvedTarget.walletFriendly}`);
            haptic.success();
        } catch (submitError) {
            setError(safeErrorMessage(submitError) || t('error_occurred'));
            haptic.error();
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <section className={styles.root}>
            <div className={styles.card}>
                <div className={styles.header}>
                    <h3>{t('admin_topup_title') || 'Manual balance top up'}</h3>
                    <p>{t('admin_topup_subtitle') || 'Find recipient wallet by username or wallet address and add UZS manually.'}</p>
                </div>

                <RecipientLookupField
                    recipientType={recipientType}
                    onRecipientTypeChange={(nextType) => {
                        setRecipientType(nextType);
                        setError('');
                        setSuccess('');
                        haptic.selection();
                    }}
                    walletTabLabel={t('wallet') || 'Wallet'}
                    usernameValue={usernameInput}
                    walletValue={walletBodyInput}
                    usernamePlaceholder={t('wallet_send_username_placeholder') || 'username'}
                    walletPlaceholder={t('wallet_send_wallet_placeholder') || 'XXXXXXXXXXXX'}
                    onUsernameChange={(rawValue) => {
                        const nextUsername = sanitizeUsernameInput(rawValue);
                        setUsernameInput(nextUsername);
                        setUsernameTarget((current) => {
                            if (!current) {
                                return null;
                            }

                            const currentUsername = sanitizeUsernameInput(current.user?.username || '');
                            if (!currentUsername || !nextUsername) {
                                return null;
                            }

                            return currentUsername.toLowerCase() === nextUsername.toLowerCase()
                                ? current
                                : null;
                        });
                        setError('');
                        setSuccess('');
                    }}
                    onWalletChange={(rawValue) => {
                        setWalletBodyInput(sanitizeFriendlyBody(rawValue));
                        setError('');
                        setSuccess('');
                    }}
                    usernameAvatarUrl={hasExactUsernameMatch ? (usernameTarget?.user?.photoUrl || null) : null}
                    walletSuggestion={recipientType === 'wallet' && suggestedWallet
                        ? {
                            displayName: usernameDisplayName,
                            address: suggestedWallet,
                            photoUrl: usernameTarget?.user?.photoUrl || null,
                            onSelect: () => {
                                setWalletBodyInput(sanitizeFriendlyBody(suggestedWallet));
                                setError('');
                                haptic.selection();
                            },
                        }
                        : null}
                />

                <div className={styles.lookupState}>
                    {recipientType === 'username' ? (
                        isUsernameLookupLoading ? (
                            <span className={styles.lookupHint}><Loader2 size={14} className={styles.spin} /> {t('admin_topup_lookup_loading') || 'Searching...'}</span>
                        ) : hasExactUsernameMatch && usernameTarget ? (
                            <span className={styles.lookupSuccess}><CheckCircle2 size={14} /> {resolveTargetDisplayName(usernameTarget, t('wallet_send_to_label') || 'Recipient')} - {usernameTarget.walletFriendly}</span>
                        ) : normalizedUsername.length >= 2 ? (
                            <span className={styles.lookupError}><AlertTriangle size={14} /> {t('admin_topup_username_not_found') || 'User not found'}</span>
                        ) : (
                            <span className={styles.lookupHint}><UserRound size={14} /> {t('admin_topup_username_hint') || 'Enter username to find recipient wallet'}</span>
                        )
                    ) : (
                        isWalletLookupLoading ? (
                            <span className={styles.lookupHint}><Loader2 size={14} className={styles.spin} /> {t('admin_topup_lookup_loading') || 'Searching...'}</span>
                        ) : walletTarget ? (
                            <span className={styles.lookupSuccess}><CheckCircle2 size={14} /> {resolveTargetDisplayName(walletTarget, t('admin_topup_unlinked_user') || 'No linked Telegram account')} - {walletTarget.walletFriendly}</span>
                        ) : normalizedWalletBody.length >= 4 ? (
                            <span className={styles.lookupError}><AlertTriangle size={14} /> {t('admin_topup_wallet_not_found') || 'Wallet not found'}</span>
                        ) : (
                            <span className={styles.lookupHint}><Wallet size={14} /> {t('admin_topup_wallet_hint') || 'Enter wallet to continue'}</span>
                        )
                    )}
                </div>

                <div className={styles.amountBlock}>
                    <label htmlFor="admin-topup-amount">{t('admin_topup_amount_label') || 'Amount'}</label>
                    <div className={styles.amountInputWrap}>
                        <input
                            id="admin-topup-amount"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9 ]*"
                            value={amountInput}
                            placeholder={t('admin_topup_amount_placeholder') || '1 000'}
                            onChange={(event) => {
                                setSelectedQuickAmount(null);
                                setAmountInput(formatAmountInput(event.target.value));
                                setError('');
                                setSuccess('');
                            }}
                            className={styles.amountInput}
                        />
                        <span className={styles.amountSuffix}>UZS</span>
                    </div>

                    <div className={styles.quickGrid}>
                        {QUICK_AMOUNTS.map((value) => (
                            <button
                                key={value}
                                type="button"
                                className={`${styles.quickButton} ${selectedQuickAmount === value ? styles.quickButtonActive : ''}`}
                                onClick={() => {
                                    setSelectedQuickAmount(value);
                                    setAmountInput(formatAmountInput(String(value)));
                                    setError('');
                                    setSuccess('');
                                    haptic.selection();
                                }}
                            >
                                {formatAmountValue(value)} UZS
                            </button>
                        ))}
                    </div>
                </div>

                {error && (
                    <div className={styles.errorBox}>
                        <AlertTriangle size={16} />
                        <span>{error}</span>
                    </div>
                )}

                {success && (
                    <div className={styles.successBox}>
                        <CheckCircle2 size={16} />
                        <span>{success}</span>
                    </div>
                )}

                <Button
                    type="button"
                    fullWidth
                    onClick={handleContinue}
                    disabled={!canContinue || isSubmitting}
                >
                    {t('continue') || 'Continue'}
                </Button>
            </div>

            <BottomDrawer
                open={isConfirmOpen}
                onClose={() => {
                    if (!isSubmitting) {
                        setIsConfirmOpen(false);
                    }
                }}
                title={t('admin_topup_confirm_title') || 'Confirm top up'}
                closeAriaLabel={t('transactions_close') || 'Close'}
                bodyClassName={styles.drawerBody}
            >
                {confirmPayload && (
                    <div className={styles.confirmContent}>
                        <DetailsTable
                            className={styles.confirmTable}
                            rows={[
                                {
                                    id: 'mode',
                                    label: t('admin_topup_confirm_mode') || 'Search mode',
                                    value: confirmPayload.sourceType === 'username'
                                        ? (t('admin_topup_mode_username') || 'Username')
                                        : (t('admin_topup_mode_wallet') || 'Wallet'),
                                },
                                {
                                    id: 'recipient',
                                    label: t('admin_topup_confirm_recipient') || 'Recipient',
                                    value: resolveTargetDisplayName(confirmPayload.target, t('admin_topup_unlinked_user') || 'No linked Telegram account'),
                                },
                                {
                                    id: 'wallet',
                                    label: t('wallet') || 'Wallet',
                                    value: confirmPayload.target.walletFriendly,
                                    mono: true,
                                },
                                {
                                    id: 'amount',
                                    label: t('admin_topup_amount_label') || 'Amount',
                                    value: `${formatAmountValue(confirmPayload.amount)} UZS`,
                                },
                            ]}
                        />

                        <SwipeConfirmAction
                            label={t('transfer_swipe_confirm') || 'Confirm'}
                            onConfirm={handleConfirmTopup}
                            disabled={isSubmitting}
                            loading={isSubmitting}
                            resetKey={`${isConfirmOpen}-${confirmPayload.target.walletFriendly}-${confirmPayload.amount}`}
                        />
                    </div>
                )}
            </BottomDrawer>
        </section>
    );
}
