'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Send, Check, Loader2, ArrowRight, ChevronLeft, Tag, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TgsPlayer } from '@/components/ui/TgsPlayer';
import { useTelegram } from '@/lib/context/TelegramContext';
import { useLanguage } from '@/lib/context/LanguageContext';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';
import { api } from '@/lib/api';
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

const WALLET_PREFIX = 'LV-';
const WALLET_BODY_MAX_LENGTH = 12;
const USERNAME_MAX_LENGTH = 32;
const USER_LOOKUP_DEBOUNCE_MS = 420;
const TRANSFER_DRAFT_STORAGE_PREFIX = 'transfer_modal_draft_v2';
const TRANSFER_MEMO_MAX_LENGTH = 120;
const TRANSFER_FEE_AMOUNT_TEXT = '741 UZS';
const SWIPE_HANDLE_SIZE = 44;
const SWIPE_TRACK_HORIZONTAL_PADDING = 6;
const SWIPE_COMPLETE_THRESHOLD = 0.96;

const stripUsernameTransportPrefix = (value: string): string => {
    return value.trim().replace(/^@+/, '');
};

const sanitizeWalletBody = (value: string): string => {
    const withoutFriendlyPrefix = value.trim().replace(/^(?:LV-|UZ-)/i, '');
    const upper = withoutFriendlyPrefix.toUpperCase().replace(/[^A-Z0-9_]/g, '');

    let normalized = upper;
    while (normalized.startsWith('_')) {
        normalized = normalized.slice(1);
    }

    let seenUnderscore = false;
    let result = '';

    for (const char of normalized) {
        if (char === '_') {
            if (seenUnderscore) {
                continue;
            }
            seenUnderscore = true;
        }

        result += char;

        if (result.length >= WALLET_BODY_MAX_LENGTH) {
            break;
        }
    }

    return result;
};

const normalizeWalletRecipient = (value: string): string => {
    const withoutPrefix = value.trim().replace(/^(?:LV-|UZ-)/i, '');
    const body = sanitizeWalletBody(withoutPrefix);
    return `${WALLET_PREFIX}${body}`;
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
    const [swipeOffset, setSwipeOffset] = useState(0);
    const [swipeMaxOffset, setSwipeMaxOffset] = useState(0);
    const [isSwiping, setIsSwiping] = useState(false);
    const [isTransferSubmitting, setIsTransferSubmitting] = useState(false);
    const [swipeResult, setSwipeResult] = useState<'success' | 'error' | null>(null);

    const lookupSeqRef = useRef(0);
    const swipeTrackRef = useRef<HTMLDivElement | null>(null);
    const swipePointerIdRef = useRef<number | null>(null);
    const swipeStartXRef = useRef(0);
    const swipeStartOffsetRef = useRef(0);

    useBodyScrollLock(Boolean(nft && isOpen && visible));

    const draftKey = useMemo(() => {
        if (!nft?.tokenId) {
            return null;
        }

        const userKey = authUser?.uid || 'anonymous';
        return `${TRANSFER_DRAFT_STORAGE_PREFIX}:${userKey}:${nft.tokenId}`;
    }, [authUser?.uid, nft?.tokenId]);

    const username = useMemo(() => sanitizeUsernameInput(usernameInput), [usernameInput]);
    const walletRecipient = useMemo(() => `${WALLET_PREFIX}${walletBody}`, [walletBody]);
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

        if (!source || !source.toUpperCase().startsWith(WALLET_PREFIX)) {
            return '';
        }

        const candidate = normalizeWalletRecipient(source);
        const candidateBody = sanitizeWalletBody(candidate.replace(/^LV-/i, ''));

        if (!candidateBody) {
            return '';
        }

        return `${WALLET_PREFIX}${candidateBody}`;
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
        setSwipeOffset(0);
        setSwipeMaxOffset(0);
        setIsSwiping(false);
        setIsTransferSubmitting(false);
        setSwipeResult(null);
        swipePointerIdRef.current = null;
        swipeStartXRef.current = 0;
        swipeStartOffsetRef.current = 0;
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

    const recalculateSwipeBounds = useCallback(() => {
        const trackElement = swipeTrackRef.current;

        if (!trackElement) {
            return;
        }

        const trackWidth = trackElement.getBoundingClientRect().width;
        const maxOffset = Math.max(0, trackWidth - SWIPE_HANDLE_SIZE - (SWIPE_TRACK_HORIZONTAL_PADDING * 2));

        setSwipeMaxOffset(maxOffset);
        setSwipeOffset((current) => Math.min(current, maxOffset));
    }, []);

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

    useEffect(() => {
        if (step !== 'confirm') {
            setSwipeOffset(0);
            setSwipeMaxOffset(0);
            setIsSwiping(false);
            setIsTransferSubmitting(false);
            setSwipeResult(null);
            swipePointerIdRef.current = null;
            return;
        }

        const frameId = window.requestAnimationFrame(recalculateSwipeBounds);
        const handleResize = () => {
            recalculateSwipeBounds();
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('resize', handleResize);
        };
    }, [recalculateSwipeBounds, step]);

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
            setSwipeOffset(0);
            setSwipeResult(null);
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
        setSwipeOffset(0);
        setSwipeResult(null);
        setStep('confirm');
    };

    const handleBackToInfo = () => {
        if (isTransferSubmitting) {
            return;
        }

        haptic.impact('light');
        if (step === 'confirm') {
            setStep('input');
            setError('');
            setSwipeOffset(0);
            setSwipeResult(null);
            return;
        }

        setStep('input');
        setError('');
        setViewMode('info');
    };

    const submitTransfer = useCallback(async (): Promise<boolean> => {
        if (!authUser?.uid) {
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
                transferData.toAddress = normalizeWalletRecipient(walletRecipient);
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
    }, [authUser?.uid, memoInput, nft?.tokenId, recipientType, username, walletRecipient, webApp?.initData]);

    const confirmSwipeTransfer = useCallback(async () => {
        if (isTransferSubmitting) {
            return;
        }

        setIsTransferSubmitting(true);
        setSwipeResult(null);
        haptic.impact('heavy');
        setSwipeOffset(swipeMaxOffset);

        const isSuccess = await submitTransfer();
        if (isSuccess) {
            haptic.impact('medium');
            setSwipeResult('success');
            clearDraft();
            onSuccess?.();
            setIsTransferSubmitting(false);
            return;
        }

        haptic.error();
        setSwipeResult('error');
        setSwipeOffset(0);
        setIsTransferSubmitting(false);
    }, [clearDraft, haptic, isTransferSubmitting, onSuccess, submitTransfer, swipeMaxOffset]);

    const handleSwipePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (step !== 'confirm' || swipeMaxOffset <= 0 || isTransferSubmitting || swipeResult === 'success') {
            return;
        }

        event.preventDefault();
        swipePointerIdRef.current = event.pointerId;
        swipeStartXRef.current = event.clientX;
        swipeStartOffsetRef.current = swipeOffset;
        setIsSwiping(true);
        setSwipeResult(null);
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleSwipePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (swipePointerIdRef.current !== event.pointerId || isTransferSubmitting) {
            return;
        }

        event.preventDefault();
        const deltaX = event.clientX - swipeStartXRef.current;
        const nextOffset = Math.min(swipeMaxOffset, Math.max(0, swipeStartOffsetRef.current + deltaX));
        setSwipeOffset(nextOffset);
    };

    const finalizeSwipe = async (event: React.PointerEvent<HTMLButtonElement>) => {
        if (swipePointerIdRef.current !== event.pointerId) {
            return;
        }

        try {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
        } catch {
            // Pointer capture might already be released by the browser.
        }

        swipePointerIdRef.current = null;
        setIsSwiping(false);

        if (isTransferSubmitting) {
            return;
        }

        const reachedEnd = swipeMaxOffset > 0 && swipeOffset >= (swipeMaxOffset * SWIPE_COMPLETE_THRESHOLD);
        if (!reachedEnd) {
            haptic.selection();
            setSwipeOffset(0);
            return;
        }

        setSwipeOffset(swipeMaxOffset);
        await confirmSwipeTransfer();
    };

    const handleSwipePointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (swipePointerIdRef.current !== event.pointerId) {
            return;
        }

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        swipePointerIdRef.current = null;
        setIsSwiping(false);
        if (isTransferSubmitting) {
            return;
        }
        setSwipeOffset(0);
    };

    const displayRecipient = recipientType === 'username'
        ? `@${(isExactUsernameMatch && resolvedUsername) ? resolvedUsername : username}`
        : normalizeWalletRecipient(walletRecipient);

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
    const showBackButton = (step === 'input' && viewMode === 'transfer') || step === 'confirm';

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
                                <Tag size={19} className={styles.modeActionIcon} />
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
                                <Send size={19} className={styles.modeActionIcon} />
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
                                <Sparkles size={19} className={styles.modeActionIcon} />
                                <span className={styles.modeActionLabel}>
                                    {t('transfer_modal_upgrade') || 'Upgrade'}
                                </span>
                            </button>
                        </div>

                        {viewMode === 'info' ? (
                            <table className={styles.infoTable}>
                                <tbody>
                                    <tr className={styles.infoRow}>
                                        <th className={styles.infoKey} scope="row">{t('owner') || 'Owner'}</th>
                                        <td className={styles.infoValue}>
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
                                        </td>
                                    </tr>
                                    <tr className={styles.infoRow}>
                                        <th className={styles.infoKey} scope="row">{t('model') || 'Model'}</th>
                                        <td className={styles.infoValue}>{nft.modelName}</td>
                                    </tr>
                                    <tr className={styles.infoRow}>
                                        <th className={styles.infoKey} scope="row">
                                            {t('transfer_modal_availability') || 'Availability'}
                                        </th>
                                        <td className={`${styles.infoValue} ${styles.infoValueMono}`}>
                                            {availabilityText}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        ) : (
                            <>
                                {/* Recipient Input */}
                                <div className={styles.inputSection}>
                                    <div className={styles.tabs}>
                                        <button
                                            className={`${styles.tab} ${recipientType === 'username' ? styles.active : ''}`}
                                            onClick={() => {
                                                setRecipientType('username');
                                                setError('');
                                            }}
                                        >
                                            @username
                                        </button>
                                        <button
                                            className={`${styles.tab} ${recipientType === 'wallet' ? styles.active : ''}`}
                                            onClick={() => {
                                                setRecipientType('wallet');
                                                setError('');
                                            }}
                                        >
                                            {t('wallet')}
                                        </button>
                                    </div>

                                    {recipientType === 'wallet' && suggestedWallet && (
                                        <button
                                            type="button"
                                            className={styles.walletSuggestion}
                                            onClick={() => {
                                                setWalletBody(sanitizeWalletBody(suggestedWallet.replace(/^LV-/i, '')));
                                                setError('');
                                                haptic.selection();
                                            }}
                                        >
                                            <span className={styles.walletSuggestionAvatarWrap}>
                                                {isExactUsernameMatch && resolvedRecipient?.photoUrl ? (
                                                    <img
                                                        src={resolvedRecipient.photoUrl}
                                                        alt=""
                                                        className={styles.walletSuggestionAvatar}
                                                        loading="lazy"
                                                        referrerPolicy="no-referrer"
                                                    />
                                                ) : (
                                                    <span className={styles.walletSuggestionAvatarFallback}>@</span>
                                                )}
                                            </span>
                                            <span className={styles.walletSuggestionMeta}>
                                                <span className={styles.walletSuggestionName}>{suggestionDisplayName}</span>
                                                <span className={styles.walletSuggestionAddress}>{suggestedWallet}</span>
                                            </span>
                                        </button>
                                    )}

                                    <div className={styles.inputWrapper}>
                                        {recipientType === 'username' && (
                                            <span className={styles.inputPrefixSlot}>
                                                {isExactUsernameMatch && resolvedRecipient?.photoUrl ? (
                                                    <img
                                                        src={resolvedRecipient.photoUrl}
                                                        alt=""
                                                        className={styles.inputPrefixAvatar}
                                                        loading="lazy"
                                                        referrerPolicy="no-referrer"
                                                    />
                                                ) : (
                                                    <span className={styles.inputPrefix}>@</span>
                                                )}
                                            </span>
                                        )}
                                        {recipientType === 'wallet' && (
                                            <span className={styles.inputPrefix}>{WALLET_PREFIX}</span>
                                        )}
                                        <input
                                            type="text"
                                            className={styles.input}
                                            placeholder={recipientType === 'username' ? 'username' : 'XXXXXXXXXXXX'}
                                            value={recipientType === 'wallet' ? walletBody : usernameInput}
                                            onChange={(e) => {
                                                if (recipientType === 'wallet') {
                                                    setWalletBody(sanitizeWalletBody(e.target.value));
                                                } else {
                                                    const nextUsername = sanitizeUsernameInput(e.target.value);
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
                                                }
                                                setError('');
                                            }}
                                        />
                                    </div>

                                    <div className={styles.memoField}>
                                        <span className={styles.memoLabel}>
                                            {t('transactions_comment') || 'Comment'}
                                        </span>
                                        <textarea
                                            className={styles.memoInput}
                                            value={memoInput}
                                            onChange={(event) => setMemoInput(sanitizeMemoInput(event.target.value))}
                                            placeholder={t('transfer_memo_placeholder') || 'Optional comment'}
                                            maxLength={TRANSFER_MEMO_MAX_LENGTH}
                                            rows={3}
                                        />
                                        <span className={styles.memoCounter}>
                                            {memoLength}/{TRANSFER_MEMO_MAX_LENGTH}
                                        </span>
                                    </div>

                                    {error && <p className={styles.error}>{error}</p>}
                                </div>

                                <Button
                                    fullWidth
                                    disabled={!canContinue}
                                    onClick={handleContinue}
                                >
                                    {t('continue') || 'Continue'}
                                </Button>
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
                            <div className={styles.swipeTrack} ref={swipeTrackRef}>
                                <div
                                    className={styles.swipeFill}
                                    style={{ width: `${SWIPE_HANDLE_SIZE + swipeOffset + (SWIPE_TRACK_HORIZONTAL_PADDING * 2)}px` }}
                                ></div>
                                <span className={styles.swipeLabel}>
                                    {t('transfer_swipe_confirm') || 'Confirm'}
                                </span>
                                <button
                                    type="button"
                                    className={`${styles.swipeHandle} ${isSwiping ? styles.swipeHandleActive : ''}`}
                                    style={{ transform: `translateX(${swipeOffset}px)` }}
                                    onPointerDown={handleSwipePointerDown}
                                    onPointerMove={handleSwipePointerMove}
                                    onPointerUp={finalizeSwipe}
                                    onPointerCancel={handleSwipePointerCancel}
                                    disabled={isTransferSubmitting}
                                    aria-label={t('transfer_swipe_confirm') || 'Confirm'}
                                >
                                    {isTransferSubmitting ? (
                                        <Loader2 size={20} className={styles.swipeSpinner} />
                                    ) : (
                                        <ArrowRight size={20} />
                                    )}
                                </button>
                            </div>

                            {swipeResult && (
                                <div className={styles.swipeResultRow}>
                                    <span
                                        className={`${styles.swipeResultIcon} ${
                                            swipeResult === 'success' ? styles.swipeResultSuccess : styles.swipeResultError
                                        }`}
                                    >
                                        {swipeResult === 'success' ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
