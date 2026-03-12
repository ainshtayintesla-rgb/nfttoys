'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, ArrowRight, ChevronLeft } from 'lucide-react';
import { IoSend, IoPricetag, IoSparkles } from 'react-icons/io5';
import { Button } from '@/components/ui/Button';
import { DetailsTable } from '@/components/ui/DetailsTable';
import { RecipientLookupField } from '@/components/ui/RecipientLookupField';
import { SwipeConfirmWithSuccess } from '@/components/ui/SwipeConfirmWithSuccess';
import { TgsPlayer } from '@/components/ui/TgsPlayer';
import { useTelegram } from '@/lib/context/TelegramContext';
import { useLanguage } from '@/lib/context/LanguageContext';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';
import { api } from '@/lib/api';
import {
    WALLET_FRIENDLY_BODY_LENGTH,
    WALLET_FRIENDLY_PREFIX,
    buildWalletFriendlyAddress,
    normalizeWalletFriendlyAddress,
    sanitizeWalletFriendlyBody,
} from '@/lib/wallet/network';
import styles from './TransferModal.module.css';

interface NFTItem {
    tokenId: string;
    modelName: string;
    serialNumber: string | number;
    collectionName?: string | null;
    collectionActiveCount?: number | null;
    collectionMintedCount?: number | null;
    rarity: string;
    tgsUrl: string;
}

interface TransferModalProps {
    isOpen: boolean;
    onClose: () => void;
    nft: NFTItem | null;
    onSuccess?: () => void;
}

interface RecipientLookupResult {
    id: string;
    username: string | null;
    firstName: string | null;
    photoUrl: string | null;
    walletFriendly: string | null;
}

interface TransferDraft {
    recipientType: 'username' | 'wallet';
    usernameInput: string;
    walletBody: string;
    memoInput: string;
    step: 'input' | 'confirm';
    resolvedRecipient: RecipientLookupResult | null;
    viewMode: 'info' | 'transfer';
}

const WALLET_BODY_MAX_LENGTH = WALLET_FRIENDLY_BODY_LENGTH;
const USERNAME_MAX_LENGTH = 32;
const USER_LOOKUP_DEBOUNCE_MS = 420;
const TRANSFER_DRAFT_STORAGE_PREFIX = 'transfer_modal_draft_v2';
const TRANSFER_MEMO_MAX_LENGTH = 120;
const TRANSFER_FEE_AMOUNT_TEXT = '741 UZS';

const stripUsernameTransportPrefix = (value: string): string => {
    return value.trim().replace(/^@+/, '');
};

const sanitizeWalletBody = (value: string): string => {
    return sanitizeWalletFriendlyBody(value).slice(0, WALLET_BODY_MAX_LENGTH);
};

const normalizeWalletRecipient = (value: string): string => {
    return buildWalletFriendlyAddress(value);
};

const sanitizeUsernameInput = (value: string): string => {
    const normalizedSource = stripUsernameTransportPrefix(value);
    const clean = normalizedSource.replace(/[^a-zA-Z0-9_]/g, '');
    return clean.slice(0, USERNAME_MAX_LENGTH);
};

const sanitizeMemoInput = (value: string): string => value.slice(0, TRANSFER_MEMO_MAX_LENGTH);

const parseResolvedRecipient = (value: unknown): RecipientLookupResult | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const source = value as Record<string, unknown>;

    if (typeof source.id !== 'string') {
        return null;
    }

    return {
        id: source.id,
        username: typeof source.username === 'string' ? source.username : null,
        firstName: typeof source.firstName === 'string' ? source.firstName : null,
        photoUrl: typeof source.photoUrl === 'string' ? source.photoUrl : null,
        walletFriendly: typeof source.walletFriendly === 'string' ? source.walletFriendly : null,
    };
};

const truncateCenterValue = (value: string, start: number, end: number): string => {
    if (!value) {
        return value;
    }

    if (value.length <= start + end + 1) {
        return value;
    }

    return `${value.slice(0, start)}...${value.slice(-end)}`;
};

const formatRecipientCompact = (value: string): string => {
    const normalized = value.trim();
    if (!normalized) {
        return '';
    }

    if (normalized.length <= 12) {
        return normalized;
    }

    return `${normalized.slice(0, 6)}...${normalized.slice(-6)}`;
};

export const TransferModal = ({ isOpen, onClose, nft, onSuccess }: TransferModalProps) => {
    const { authUser, haptic, webApp, user } = useTelegram();
    const { t } = useLanguage();

    const [step, setStep] = useState<'input' | 'confirm'>('input');
    const [recipientType, setRecipientType] = useState<'username' | 'wallet'>('username');
    const [usernameInput, setUsernameInput] = useState('');
    const [walletBody, setWalletBody] = useState('');
    const [memoInput, setMemoInput] = useState('');
    const [resolvedRecipient, setResolvedRecipient] = useState<RecipientLookupResult | null>(null);
    const [viewMode, setViewMode] = useState<'info' | 'transfer'>('info');
    const [, setIsSearchingRecipient] = useState(false);
    const [error, setError] = useState('');
    const [visible, setVisible] = useState(false);
    const [isTransferSubmitting, setIsTransferSubmitting] = useState(false);
    const [isConfirmSucceeded, setIsConfirmSucceeded] = useState(false);

    const lookupSeqRef = useRef(0);

    useBodyScrollLock(Boolean(nft && isOpen && visible));

    const draftKey = useMemo(() => {
        if (!nft?.tokenId) {
            return null;
        }

        const userKey = authUser?.uid || 'anonymous';
        return `${TRANSFER_DRAFT_STORAGE_PREFIX}:${userKey}:${nft.tokenId}`;
    }, [authUser?.uid, nft?.tokenId]);

    const username = useMemo(() => sanitizeUsernameInput(usernameInput), [usernameInput]);
    const walletRecipient = useMemo(() => buildWalletFriendlyAddress(walletBody), [walletBody]);
    const resolvedUsername = useMemo(
        () => sanitizeUsernameInput(resolvedRecipient?.username || ''),
        [resolvedRecipient?.username],
    );
    const usernameLookup = useMemo(() => username.toLowerCase(), [username]);
    const authInitData = webApp?.initData || '';
    const isExactUsernameMatch = useMemo(() => {
        if (!username || !resolvedRecipient) {
            return false;
        }

        // Backend lookup is exact-by-username from our DB.
        // Treat missing username in response as non-match.
        if (!resolvedUsername) {
            return false;
        }

        return resolvedUsername.toLowerCase() === username.toLowerCase();
    }, [resolvedRecipient, resolvedUsername, username]);

    const suggestedWallet = useMemo(() => {
        if (!isExactUsernameMatch) {
            return '';
        }

        const source = resolvedRecipient?.walletFriendly || '';
        const candidate = normalizeWalletFriendlyAddress(source) || normalizeWalletRecipient(source);
        const candidateBody = sanitizeWalletBody(candidate);

        if (!candidateBody) {
            return '';
        }

        return `${WALLET_FRIENDLY_PREFIX}${candidateBody}`;
    }, [isExactUsernameMatch, resolvedRecipient?.walletFriendly]);

    const clearDraft = useCallback(() => {
        if (!draftKey) {
            return;
        }

        try {
            sessionStorage.removeItem(draftKey);
        } catch {
            console.warn('Failed to clear transfer draft');
        }
    }, [draftKey]);

    const resetState = useCallback(() => {
        setStep('input');
        setViewMode('info');
        setRecipientType('username');
        setUsernameInput('');
        setWalletBody('');
        setMemoInput('');
        setResolvedRecipient(null);
        setIsSearchingRecipient(false);
        setError('');
        setIsTransferSubmitting(false);
        setIsConfirmSucceeded(false);
    }, []);

    const closeModal = useCallback((options?: { reset?: boolean; clearDraft?: boolean }) => {
        if (isTransferSubmitting) {
            return;
        }

        if (options?.clearDraft) {
            clearDraft();
        }

        setVisible(false);
        window.setTimeout(() => {
            if (options?.reset) {
                resetState();
            }
            onClose();
        }, 220);
    }, [clearDraft, isTransferSubmitting, onClose, resetState]);

    useEffect(() => {
        if (!isOpen || !nft) {
            return;
        }

        setVisible(true);

        if (!draftKey) {
            resetState();
            return;
        }

        try {
            const rawDraft = sessionStorage.getItem(draftKey);

            if (!rawDraft) {
                resetState();
                return;
            }

            const draft = JSON.parse(rawDraft) as Partial<TransferDraft>;

            setRecipientType(draft.recipientType === 'wallet' ? 'wallet' : 'username');
            setUsernameInput(typeof draft.usernameInput === 'string' ? sanitizeUsernameInput(draft.usernameInput) : '');
            setWalletBody(typeof draft.walletBody === 'string' ? sanitizeWalletBody(draft.walletBody) : '');
            setMemoInput(typeof draft.memoInput === 'string' ? sanitizeMemoInput(draft.memoInput) : '');
            setResolvedRecipient(parseResolvedRecipient(draft.resolvedRecipient));
            setStep(draft.step === 'confirm' ? 'confirm' : 'input');
            setViewMode(draft.step === 'confirm' || draft.viewMode === 'transfer' ? 'transfer' : 'info');
            setError('');
            setIsSearchingRecipient(false);
        } catch {
            resetState();
        }
    }, [draftKey, isOpen, nft, resetState]);

    useEffect(() => {
        if (!isOpen || !nft || !draftKey) {
            return;
        }

        const draft: TransferDraft = {
            recipientType,
            usernameInput,
            walletBody,
            memoInput,
            step: step === 'confirm' ? 'confirm' : 'input',
            resolvedRecipient,
            viewMode,
        };

        try {
            sessionStorage.setItem(draftKey, JSON.stringify(draft));
        } catch {
            console.warn('Failed to persist transfer draft');
        }
    }, [draftKey, isOpen, memoInput, nft, recipientType, resolvedRecipient, step, usernameInput, viewMode, walletBody]);

    useEffect(() => {
        if (!isOpen || !nft || viewMode !== 'transfer' || recipientType !== 'username' || step !== 'input') {
            setIsSearchingRecipient(false);
            return;
        }

        if (username.length < 2) {
            setIsSearchingRecipient(false);
            setResolvedRecipient(null);
            return;
        }

        const lookupSeq = ++lookupSeqRef.current;

        const timeoutId = window.setTimeout(async () => {
            setIsSearchingRecipient(true);

            try {
                const response = await api.nft.findRecipientByUsername(usernameLookup, authInitData || undefined);

                if (lookupSeqRef.current !== lookupSeq) {
                    return;
                }

                const nextRecipient = response?.recipient || null;
                setResolvedRecipient(nextRecipient);
            } catch {
                if (lookupSeqRef.current !== lookupSeq) {
                    return;
                }

                setResolvedRecipient(null);
            } finally {
                if (lookupSeqRef.current === lookupSeq) {
                    setIsSearchingRecipient(false);
                }
            }
        }, USER_LOOKUP_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [authInitData, isOpen, nft, recipientType, step, username, usernameLookup, viewMode]);

    useEffect(() => {
        const viewportContent = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
        let viewportMeta = document.querySelector('meta[name="viewport"]');

        if (!viewportMeta) {
            viewportMeta = document.createElement('meta');
            viewportMeta.setAttribute('name', 'viewport');
            document.head.appendChild(viewportMeta);
        }

        viewportMeta.setAttribute('content', viewportContent);
    }, []);

    const submitTransfer = useCallback(async (): Promise<boolean> => {
        if (!authUser?.uid || !nft) {
            return false;
        }

        setError('');

        try {
            const transferData: {
                tokenId: string;
                initData?: string;
                toAddress?: string;
                toUsername?: string;
                memo?: string;
            } = {
                tokenId: nft.tokenId,
                initData: webApp?.initData,
            };

            if (recipientType === 'wallet') {
                transferData.toAddress = walletRecipient;
            } else {
                transferData.toUsername = username;
            }

            const normalizedMemo = memoInput.trim();
            if (normalizedMemo) {
                transferData.memo = normalizedMemo;
            }

            await api.nft.transfer(transferData);
            return true;
        } catch (err: unknown) {
            if (err instanceof Error) {
                setError(err.message || 'Transfer failed');
            } else {
                setError('Transfer failed');
            }
            return false;
        }
    }, [authUser?.uid, memoInput, nft, recipientType, username, walletRecipient, webApp?.initData]);

    const confirmSwipeTransfer = useCallback(async (): Promise<boolean> => {
        if (isTransferSubmitting || isConfirmSucceeded) {
            return false;
        }

        setIsTransferSubmitting(true);
        setIsConfirmSucceeded(false);
        haptic.impact('heavy');

        try {
            const isSuccess = await submitTransfer();
            if (!isSuccess) {
                haptic.error();
                return false;
            }

            haptic.impact('medium');
            setIsConfirmSucceeded(true);
            clearDraft();
            onSuccess?.();
            return true;
        } finally {
            setIsTransferSubmitting(false);
        }
    }, [clearDraft, haptic, isConfirmSucceeded, isTransferSubmitting, onSuccess, submitTransfer]);

    if (!nft || (!isOpen && !visible)) return null;

    const canContinue = recipientType === 'wallet'
        ? walletBody.length > 0
        : isExactUsernameMatch;

    const handleClose = () => {
        closeModal();
    };

    const handleOverlayClose = () => {
        if (isTransferSubmitting) {
            return;
        }

        handleClose();
    };

    const handleContinue = () => {
        if (recipientType === 'wallet') {
            if (!walletBody) {
                setError(t('recipient_required') || 'Recipient is required');
                return;
            }

            haptic.impact('light');
            setIsConfirmSucceeded(false);
            setStep('confirm');
            return;
        }

        if (!username) {
            setError(t('recipient_required') || 'Recipient is required');
            return;
        }

        if (!isExactUsernameMatch) {
            setError(t('recipient_not_found') || 'User not found');
            return;
        }

        setUsernameInput(username);
        haptic.impact('light');
        setIsConfirmSucceeded(false);
        setStep('confirm');
    };

    const handleBackToInfo = () => {
        if (isTransferSubmitting || isConfirmSucceeded) {
            return;
        }

        haptic.impact('light');
        if (step === 'confirm') {
            setStep('input');
            setError('');
            setIsConfirmSucceeded(false);
            return;
        }

        setStep('input');
        setError('');
        setViewMode('info');
    };

    const handleConfirmAutoClose = () => {
        closeModal({ reset: true, clearDraft: true });
    };

    const displayRecipientWallet = recipientType === 'username' ? suggestedWallet : walletRecipient;
    const displayRecipient = formatRecipientCompact(displayRecipientWallet)
        || `@${(isExactUsernameMatch && resolvedUsername) ? resolvedUsername : username}`;

    const suggestionDisplayName = resolvedUsername
        ? `@${resolvedUsername}`
        : (resolvedRecipient?.firstName || 'Recipient');

    const ownerNameRaw = (typeof user?.first_name === 'string' ? user.first_name.trim() : '') || (t('you') || 'You');
    const ownerDisplayName = truncateCenterValue(ownerNameRaw, 3, 4);
    const ownerAvatarUrl = user?.photo_url || null;
    const ownerFallbackChar = ownerNameRaw.slice(0, 1).toUpperCase() || 'U';
    const serialAsNumber = Number.parseInt(String(nft.serialNumber), 10);
    const fallbackSupply = Number.isFinite(serialAsNumber) && serialAsNumber > 0 ? serialAsNumber : 1;
    const collectionMintedCount = typeof nft.collectionMintedCount === 'number' && nft.collectionMintedCount > 0
        ? nft.collectionMintedCount
        : fallbackSupply;
    const rawCollectionActiveCount = typeof nft.collectionActiveCount === 'number'
        ? nft.collectionActiveCount
        : collectionMintedCount;
    const collectionActiveCount = Math.max(0, Math.min(rawCollectionActiveCount, collectionMintedCount));
    const availabilityText = `${collectionActiveCount}/${collectionMintedCount} ${t('transfer_modal_issued') || 'issued'}`;
    const collectionTitle = (nft.collectionName || '').trim() || 'Plush pepe';
    const memoLength = memoInput.length;
    const showBackButton = ((step === 'input' && viewMode === 'transfer') || step === 'confirm')
        && !isConfirmSucceeded;

    return (
        <div
            className={`${styles.overlay} ${visible && isOpen ? styles.visible : ''}`}
            onClick={handleOverlayClose}
        >
            <div
                className={`${styles.modal} ${visible && isOpen ? styles.open : ''}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className={styles.dragHandle}></div>

                <button
                    className={styles.closeBtn}
                    onClick={showBackButton ? handleBackToInfo : handleClose}
                >
                    {showBackButton ? <ChevronLeft size={18} /> : <X size={18} />}
                </button>

                {/* Step 1: Input */}
                {step === 'input' && (
                    <>
                        {/* NFT Preview with Animation */}
                        <div className={styles.nftPreview}>
                            <div className={styles.nftAnimation}>
                                <TgsPlayer
                                    src={nft.tgsUrl}
                                    style={{ width: 100, height: 100 }}
                                    autoplay
                                    loop={false}
                                    renderer="svg"
                                    unstyled
                                />
                            </div>
                            <div className={styles.nftInfo}>
                                <span className={styles.nftName}>{collectionTitle}</span>
                                <span className={styles.nftSerial}>#{nft.serialNumber}</span>
                            </div>
                        </div>

                        <div className={styles.modeActions}>
                            <button
                                type="button"
                                className={`${styles.modeActionBtn} ${styles.modeActionDisabled}`}
                                disabled
                                aria-disabled="true"
                            >
                                <IoPricetag size={19} className={styles.modeActionIcon} />
                                <span className={styles.modeActionLabel}>
                                    {t('transfer_modal_sell') || 'Sell'}
                                </span>
                            </button>
                            <button
                                type="button"
                                className={`${styles.modeActionBtn} ${viewMode === 'transfer' ? styles.modeActionActive : ''}`}
                                onClick={() => {
                                    haptic.selection();
                                    setViewMode('transfer');
                                    setError('');
                                }}
                            >
                                <IoSend size={19} className={styles.modeActionIcon} />
                                <span className={styles.modeActionLabel}>
                                    {t('transfer_modal_transfer') || t('transfer') || 'Transfer'}
                                </span>
                            </button>
                            <button
                                type="button"
                                className={`${styles.modeActionBtn} ${styles.modeActionDisabled}`}
                                disabled
                                aria-disabled="true"
                            >
                                <IoSparkles size={19} className={styles.modeActionIcon} />
                                <span className={styles.modeActionLabel}>
                                    {t('transfer_modal_upgrade') || 'Upgrade'}
                                </span>
                            </button>
                        </div>

                        {viewMode === 'info' ? (
                            <DetailsTable
                                className={styles.infoTable}
                                rowClassName={styles.infoRow}
                                keyClassName={styles.infoKey}
                                valueClassName={styles.infoValue}
                                monoValueClassName={styles.infoValueMono}
                                rows={[
                                    {
                                        id: 'owner',
                                        label: t('owner') || 'Owner',
                                        value: (
                                            <span className={styles.ownerCell}>
                                                <span className={styles.ownerAvatarWrap}>
                                                    {ownerAvatarUrl ? (
                                                        <img
                                                            src={ownerAvatarUrl}
                                                            alt=""
                                                            className={styles.ownerAvatar}
                                                            loading="lazy"
                                                            referrerPolicy="no-referrer"
                                                        />
                                                    ) : (
                                                        <span className={styles.ownerAvatarFallback}>{ownerFallbackChar}</span>
                                                    )}
                                                </span>
                                                <span className={styles.ownerName}>{ownerDisplayName}</span>
                                            </span>
                                        ),
                                    },
                                    {
                                        id: 'model',
                                        label: t('model') || 'Model',
                                        value: nft.modelName,
                                    },
                                    {
                                        id: 'availability',
                                        label: t('transfer_modal_availability') || 'Availability',
                                        value: availabilityText,
                                        mono: true,
                                    },
                                ]}
                            />
                        ) : (
                            <>
                                {/* Recipient Input */}
                                <div className={styles.inputSection}>
                                    <RecipientLookupField
                                        recipientType={recipientType}
                                        onRecipientTypeChange={(nextType) => {
                                            setRecipientType(nextType);
                                            setError('');
                                        }}
                                        walletTabLabel={t('wallet') || 'Wallet'}
                                        usernameValue={usernameInput}
                                        walletValue={walletBody}
                                        usernamePlaceholder="username"
                                        walletPlaceholder="Адрес"
                                        onUsernameChange={(rawValue) => {
                                            const nextUsername = sanitizeUsernameInput(rawValue);
                                            setUsernameInput(nextUsername);
                                            setResolvedRecipient((current) => {
                                                if (!current) {
                                                    return null;
                                                }

                                                const currentUsername = sanitizeUsernameInput(current.username || '');
                                                const nextUsernameLower = nextUsername.toLowerCase();

                                                if (!nextUsernameLower || !currentUsername) {
                                                    return null;
                                                }

                                                return currentUsername.toLowerCase() === nextUsernameLower
                                                    ? current
                                                    : null;
                                            });
                                            setError('');
                                        }}
                                        onWalletChange={(rawValue) => {
                                            setWalletBody(sanitizeWalletBody(rawValue));
                                            setError('');
                                        }}
                                        usernameAvatarUrl={isExactUsernameMatch ? (resolvedRecipient?.photoUrl || null) : null}
                                        walletPrefix=""
                                        walletSuggestion={recipientType === 'wallet' && suggestedWallet
                                            ? {
                                                displayName: suggestionDisplayName,
                                                address: suggestedWallet,
                                                photoUrl: isExactUsernameMatch ? (resolvedRecipient?.photoUrl || null) : null,
                                                onSelect: () => {
                                                    setWalletBody(sanitizeWalletBody(suggestedWallet));
                                                    setError('');
                                                    haptic.selection();
                                                },
                                            }
                                            : null}
                                    />

                                    <div className={styles.memoField}>
                                        <div className={styles.memoInputWrap}>
                                            <textarea
                                                className={styles.memoInput}
                                                value={memoInput}
                                                onChange={(event) => setMemoInput(sanitizeMemoInput(event.target.value))}
                                                placeholder={t('transfer_memo_placeholder') || 'Optional comment'}
                                                maxLength={TRANSFER_MEMO_MAX_LENGTH}
                                                rows={3}
                                            />
                                            <div className={styles.memoCounterInside}>
                                                <span className={styles.memoCounter}>
                                                    {memoLength}/{TRANSFER_MEMO_MAX_LENGTH}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {error && <p className={styles.error}>{error}</p>}
                                </div>

                                <div className={styles.continueBar}>
                                    <Button
                                        fullWidth
                                        disabled={!canContinue}
                                        onClick={handleContinue}
                                        className={styles.continueButton}
                                    >
                                        {t('continue') || 'Continue'}
                                    </Button>
                                </div>
                            </>
                        )}
                    </>
                )}

                {/* Step 2: Confirm */}
                {step === 'confirm' && (
                    <div className={styles.confirmSection}>
                        {/* NFT Animation Small */}
                        <div className={styles.nftPreview}>
                            <div className={styles.nftAnimation}>
                                <TgsPlayer
                                    src={nft.tgsUrl}
                                    style={{ width: 80, height: 80 }}
                                    autoplay
                                    loop={false}
                                    renderer="svg"
                                    unstyled
                                />
                            </div>
                            <div className={styles.nftInfo}>
                                <span className={styles.nftName}>{collectionTitle}</span>
                                <span className={styles.nftSerial}>#{nft.serialNumber}</span>
                            </div>
                        </div>

                        {/* Transfer Summary */}
                        <div className={styles.transferSummary}>
                            <div className={styles.fromTo}>
                                <span className={styles.fromToLabel}>From</span>
                                <span className={styles.fromToValue}>
                                    @{user?.username || 'you'}
                                </span>
                            </div>
                            <ArrowRight size={20} className={styles.arrow} />
                            <div className={styles.fromTo}>
                                <span className={styles.fromToLabel}>To</span>
                                <span className={styles.fromToValue}>{displayRecipient}</span>
                            </div>
                        </div>

                        <div className={styles.confirmMeta}>
                            <div className={styles.confirmFee}>
                                <span className={styles.confirmFeeLabel}>
                                    {t('transactions_fee') || 'Fee'}
                                </span>
                                <span className={styles.confirmFeeValue}>{TRANSFER_FEE_AMOUNT_TEXT}</span>
                            </div>
                            {memoInput.trim() && (
                                <div className={styles.confirmMemo}>
                                    <span className={styles.confirmMemoLabel}>
                                        {t('transactions_comment') || 'Comment'}
                                    </span>
                                    <span className={styles.confirmMemoValue}>{memoInput.trim()}</span>
                                </div>
                            )}
                        </div>

                        <p className={styles.disclaimer}>
                            ⚠️ {t('transfer_warning') || 'This action is irreversible. The NFT will be transferred immediately.'}
                        </p>

                        <div className={styles.swipeConfirm}>
                            <SwipeConfirmWithSuccess
                                label={t('transfer_swipe_confirm') || 'Confirm'}
                                onConfirm={confirmSwipeTransfer}
                                isSubmitting={isTransferSubmitting}
                                isSuccess={isConfirmSucceeded}
                                onSuccessAutoClose={handleConfirmAutoClose}
                                resetKey={`${step}-${displayRecipient}-${nft.tokenId}`}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
