'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { BottomDrawer } from '@/components/ui/BottomDrawer';
import { Button } from '@/components/ui/Button';
import { DetailsTable } from '@/components/ui/DetailsTable';
import { RecipientLookupField, type RecipientLookupType } from '@/components/ui/RecipientLookupField';
import { SwipeConfirmWithSuccess } from '@/components/ui/SwipeConfirmWithSuccess';
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
    transactionId: string;
    recipientDisplay: string;
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

function createClientTransactionId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `topup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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

    const [amountInput, setAmountInput] = useState('');
    const [selectedQuickAmount, setSelectedQuickAmount] = useState<number | null>(null);

    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [confirmPayload, setConfirmPayload] = useState<ConfirmTopupPayload | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isConfirmSucceeded, setIsConfirmSucceeded] = useState(false);

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
            return;
        }

        if (normalizedUsername.length < 2) {
            usernameLookupSeqRef.current += 1;
            setUsernameTarget(null);
            return;
        }

        const lookupSeq = ++usernameLookupSeqRef.current;

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
            }
        }, LOOKUP_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [lookupTarget, normalizedUsername, recipientType]);

    useEffect(() => {
        if (recipientType !== 'wallet') {
            walletLookupSeqRef.current += 1;
            return;
        }

        if (!normalizedWalletFriendly || normalizedWalletBody.length < 4) {
            walletLookupSeqRef.current += 1;
            setWalletTarget(null);
            return;
        }

        const lookupSeq = ++walletLookupSeqRef.current;

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

    const closeConfirmDrawer = useCallback(() => {
        if (isSubmitting) {
            return;
        }

        setIsConfirmOpen(false);
        setConfirmPayload(null);
        setIsConfirmSucceeded(false);
    }, [isSubmitting]);

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

        const confirmRecipientDisplay = recipientType === 'username'
            ? (() => {
                const username = sanitizeUsernameInput(nextTarget.user?.username || normalizedUsername);
                if (username) {
                    return `@${username}`;
                }

                return nextTarget.walletFriendly;
            })()
            : nextTarget.walletFriendly;

        setIsConfirmSucceeded(false);
        setConfirmPayload({
            amount: parsedAmount,
            sourceType: recipientType,
            target: nextTarget,
            transactionId: createClientTransactionId(),
            recipientDisplay: confirmRecipientDisplay,
        });
        setIsConfirmOpen(true);
    };

    const handleConfirmTopup = async () => {
        if (!confirmPayload || isSubmitting || isConfirmSucceeded) {
            return;
        }

        setIsSubmitting(true);
        setError('');
        setSuccess('');

        try {
            const response = await api.admin.topupWallet({
                amount: confirmPayload.amount,
                wallet: confirmPayload.target.walletFriendly,
                transactionId: confirmPayload.transactionId,
            });

            const resolvedTarget = response?.target || confirmPayload.target;

            setWalletBodyInput(sanitizeFriendlyBody(resolvedTarget.walletFriendly));
            setWalletTarget(resolvedTarget);
            setAmountInput('');
            setSelectedQuickAmount(null);
            setSuccess(`${t('admin_topup_success') || 'Balance topped up'}: ${resolvedTarget.walletFriendly}`);
            setIsConfirmSucceeded(true);
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
                onClose={closeConfirmDrawer}
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
                                    id: 'recipient',
                                    label: t('admin_topup_confirm_recipient') || 'Recipient',
                                    value: confirmPayload.recipientDisplay,
                                    mono: confirmPayload.sourceType === 'wallet',
                                },
                                {
                                    id: 'amount',
                                    label: t('admin_topup_amount_label') || 'Amount',
                                    value: `${formatAmountValue(confirmPayload.amount)} UZS`,
                                },
                            ]}
                        />

                        <div className={styles.confirmSwipeSection}>
                            <SwipeConfirmWithSuccess
                                label={t('transfer_swipe_confirm') || 'Confirm'}
                                onConfirm={handleConfirmTopup}
                                isSubmitting={isSubmitting}
                                isSuccess={isConfirmSucceeded}
                                onSuccessAutoClose={closeConfirmDrawer}
                                resetKey={`${isConfirmOpen}-${confirmPayload.target.walletFriendly}-${confirmPayload.amount}-${isConfirmSucceeded}`}
                            />
                        </div>
                    </div>
                )}
            </BottomDrawer>
        </section>
    );
}
