'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, UserRound, Wallet } from 'lucide-react';

import { BottomDrawer } from '@/components/ui/BottomDrawer';
import { Button } from '@/components/ui/Button';
import { DetailsTable } from '@/components/ui/DetailsTable';
import { SwipeConfirmAction } from '@/components/ui/SwipeConfirmAction';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/context/LanguageContext';

import styles from './BalanceTopupTab.module.css';

const LOOKUP_DEBOUNCE_MS = 380;
const MAX_AMOUNT_INPUT_DIGITS = 11;
const MAX_USER_ID_INPUT_DIGITS = 20;
const QUICK_AMOUNTS = [1000, 5000, 10000, 50000, 100000];

interface LookupWalletSummary {
    address: string;
    friendlyAddress: string;
    balance: number;
    nftCount: number;
    createdAt: string | null;
}

interface LookupUser {
    id: string;
    telegramId: string | null;
    username: string | null;
    firstName: string | null;
    photoUrl: string | null;
    wallet: LookupWalletSummary | null;
}

function formatIntegerWithSpaces(value: number): string {
    return String(Math.max(0, Math.trunc(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
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

function parseAmountInput(value: string): number | null {
    const digits = normalizeAmountDigits(value);
    if (!digits) {
        return null;
    }

    const parsed = Number.parseInt(digits, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
}

function sanitizeTelegramIdInput(value: string): string {
    return value.replace(/[^0-9]/g, '').slice(0, MAX_USER_ID_INPUT_DIGITS);
}

function getDisplayName(user: LookupUser): string {
    if (user.username) {
        return `@${user.username}`;
    }

    if (user.firstName) {
        return user.firstName;
    }

    return user.id;
}

function getTelegramNumericId(user: LookupUser): string {
    if (user.telegramId) {
        return user.telegramId;
    }

    return user.id.replace(/^telegram_/i, '');
}

export const BalanceTopupTab = () => {
    const { t } = useLanguage();

    const [userIdInput, setUserIdInput] = useState('');
    const [targetUser, setTargetUser] = useState<LookupUser | null>(null);
    const [lookupError, setLookupError] = useState('');
    const [isLookupLoading, setIsLookupLoading] = useState(false);

    const [amountInput, setAmountInput] = useState('');
    const [selectedQuickAmount, setSelectedQuickAmount] = useState<number | null>(null);
    const [actionError, setActionError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [confirmResetKey, setConfirmResetKey] = useState(0);

    const lookupSeqRef = useRef(0);

    const parsedAmount = useMemo(() => parseAmountInput(amountInput), [amountInput]);
    const hasWallet = Boolean(targetUser?.wallet);
    const canContinue = Boolean(targetUser && hasWallet && parsedAmount && parsedAmount > 0);

    const currentBalance = targetUser?.wallet?.balance || 0;
    const nextBalance = currentBalance + (parsedAmount || 0);

    useEffect(() => {
        const trimmed = userIdInput.trim();

        if (!trimmed) {
            setTargetUser(null);
            setLookupError('');
            setIsLookupLoading(false);
            return;
        }

        if (trimmed.length < 4) {
            setTargetUser(null);
            setLookupError('');
            setIsLookupLoading(false);
            return;
        }

        const lookupSeq = ++lookupSeqRef.current;

        const timeoutId = window.setTimeout(async () => {
            setIsLookupLoading(true);
            setLookupError('');

            try {
                const response = await api.admin.lookupUserById(trimmed);

                if (lookupSeqRef.current !== lookupSeq) {
                    return;
                }

                const nextUser = response?.user || null;
                setTargetUser(nextUser);

                if (!nextUser) {
                    setLookupError(t('admin_topup_not_found') || 'User not found');
                }
            } catch (error) {
                if (lookupSeqRef.current !== lookupSeq) {
                    return;
                }

                setTargetUser(null);
                setLookupError(error instanceof Error ? error.message : (t('error_occurred') || 'Request failed'));
            } finally {
                if (lookupSeqRef.current === lookupSeq) {
                    setIsLookupLoading(false);
                }
            }
        }, LOOKUP_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [t, userIdInput]);

    const handleOpenConfirm = () => {
        if (!canContinue) {
            return;
        }

        setActionError('');
        setSuccessMessage('');
        setConfirmResetKey((current) => current + 1);
        setIsConfirmOpen(true);
    };

    const handleSubmitTopup = useCallback(async () => {
        if (!targetUser || !targetUser.wallet || !parsedAmount) {
            setActionError(t('admin_topup_invalid_state') || 'Choose user and amount first');
            return false;
        }

        setActionError('');

        try {
            const response = await api.admin.topupUserWallet({
                userId: userIdInput,
                amount: parsedAmount,
            });

            const refreshedUser = response?.user || null;
            if (refreshedUser) {
                setTargetUser(refreshedUser);
            }

            setSuccessMessage(`${t('admin_topup_success') || 'Balance topped up'} +${formatIntegerWithSpaces(parsedAmount)} UZS`);
            setAmountInput('');
            setSelectedQuickAmount(null);
            setIsConfirmOpen(false);
            return true;
        } catch (error) {
            setActionError(error instanceof Error ? error.message : (t('error_occurred') || 'Request failed'));
            return false;
        }
    }, [parsedAmount, t, targetUser, userIdInput]);

    return (
        <div className={styles.root}>
            <div className={styles.card}>
                <div className={styles.headline}>
                    <h3>{t('admin_topup_title') || 'Manual balance top up'}</h3>
                    <p>{t('admin_topup_desc') || 'Find user by Telegram ID and add UZS manually.'}</p>
                </div>

                <label className={styles.label} htmlFor="admin-topup-user-id">
                    {t('admin_topup_user_id') || 'User ID'}
                </label>
                <div className={styles.userIdInputWrap}>
                    <Search size={16} className={styles.inputIcon} />
                    <input
                        id="admin-topup-user-id"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={userIdInput}
                        onChange={(event) => {
                            setUserIdInput(sanitizeTelegramIdInput(event.target.value));
                            setActionError('');
                            setSuccessMessage('');
                        }}
                        placeholder={t('admin_topup_user_id_placeholder') || '123456789'}
                        className={styles.userIdInput}
                    />
                </div>
                <p className={styles.caption}>
                    {t('admin_topup_user_id_hint') || 'Enter numeric Telegram user ID'}
                </p>

                {isLookupLoading && (
                    <p className={styles.lookupState}>{t('admin_topup_searching') || 'Searching user...'}</p>
                )}

                {lookupError && !isLookupLoading && (
                    <p className={styles.errorText}>{lookupError}</p>
                )}

                {targetUser && (
                    <div className={styles.userCard}>
                        <div className={styles.userAvatar}>
                            {targetUser.photoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={targetUser.photoUrl} alt={getDisplayName(targetUser)} />
                            ) : (
                                <UserRound size={18} />
                            )}
                        </div>

                        <div className={styles.userMeta}>
                            <strong>{getDisplayName(targetUser)}</strong>
                            <span>ID: {getTelegramNumericId(targetUser)}</span>
                            <span>{targetUser.wallet?.friendlyAddress || (t('admin_topup_wallet_missing') || 'Wallet is missing')}</span>
                        </div>

                        <div className={styles.balanceBadge}>
                            <Wallet size={14} />
                            <span>{formatIntegerWithSpaces(targetUser.wallet?.balance || 0)} UZS</span>
                        </div>
                    </div>
                )}

                <label className={styles.label} htmlFor="admin-topup-amount">
                    {t('wallet_amount_label') || 'Amount'}
                </label>
                <div className={styles.amountInputWrap}>
                    <input
                        id="admin-topup-amount"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9 ]*"
                        value={amountInput}
                        onChange={(event) => {
                            setSelectedQuickAmount(null);
                            setAmountInput(formatAmountInput(event.target.value));
                            setActionError('');
                            setSuccessMessage('');
                        }}
                        placeholder="1 000"
                        className={styles.amountInput}
                    />
                    <span className={styles.currency}>UZS</span>
                </div>

                <div className={styles.quickGrid}>
                    {QUICK_AMOUNTS.map((amount) => (
                        <button
                            key={amount}
                            type="button"
                            className={`${styles.quickButton} ${selectedQuickAmount === amount ? styles.quickButtonActive : ''}`}
                            onClick={() => {
                                setSelectedQuickAmount(amount);
                                setAmountInput(formatAmountInput(String(amount)));
                                setActionError('');
                                setSuccessMessage('');
                            }}
                        >
                            {formatIntegerWithSpaces(amount)} UZS
                        </button>
                    ))}
                </div>

                {!hasWallet && targetUser && (
                    <p className={styles.errorText}>{t('admin_topup_wallet_missing') || 'User does not have wallet yet'}</p>
                )}

                {actionError && !isConfirmOpen && (
                    <p className={styles.errorText}>{actionError}</p>
                )}

                {successMessage && (
                    <p className={styles.successText}>{successMessage}</p>
                )}

                <Button type="button" fullWidth onClick={handleOpenConfirm} disabled={!canContinue}>
                    {t('continue') || 'Continue'}
                </Button>
            </div>

            <BottomDrawer
                open={isConfirmOpen}
                onClose={() => setIsConfirmOpen(false)}
                title={t('admin_topup_confirm_title') || 'Confirm top up'}
                closeAriaLabel="Close"
                bodyClassName={styles.drawerBody}
            >
                {targetUser?.wallet && (
                    <div className={styles.confirmContent}>
                        <p className={styles.confirmText}>
                            {t('admin_topup_confirm_desc') || 'Review details below and swipe to confirm.'}
                        </p>

                        <DetailsTable
                            className={styles.confirmTable}
                            rowClassName={styles.confirmRow}
                            keyClassName={styles.confirmKey}
                            valueClassName={styles.confirmValue}
                            rows={[
                                {
                                    id: 'user',
                                    label: t('admin_topup_user') || 'User',
                                    value: getDisplayName(targetUser),
                                },
                                {
                                    id: 'userId',
                                    label: t('admin_topup_user_id') || 'User ID',
                                    value: getTelegramNumericId(targetUser),
                                },
                                {
                                    id: 'wallet',
                                    label: t('admin_topup_wallet') || 'Wallet',
                                    value: targetUser.wallet.friendlyAddress,
                                },
                                {
                                    id: 'balanceCurrent',
                                    label: t('admin_topup_balance_current') || 'Current balance',
                                    value: `${formatIntegerWithSpaces(currentBalance)} UZS`,
                                },
                                {
                                    id: 'amount',
                                    label: t('wallet_amount_label') || 'Amount',
                                    value: parsedAmount ? `${formatIntegerWithSpaces(parsedAmount)} UZS` : '—',
                                },
                                {
                                    id: 'balanceNext',
                                    label: t('admin_topup_balance_next') || 'Balance after top up',
                                    value: parsedAmount ? `${formatIntegerWithSpaces(nextBalance)} UZS` : '—',
                                },
                            ]}
                        />

                        {actionError && (
                            <p className={styles.errorText}>{actionError}</p>
                        )}

                        <SwipeConfirmAction
                            label={t('transfer_swipe_confirm') || 'Confirm'}
                            onConfirm={handleSubmitTopup}
                            disabled={!canContinue}
                            resetKey={confirmResetKey}
                        />
                    </div>
                )}
            </BottomDrawer>
        </div>
    );
};
