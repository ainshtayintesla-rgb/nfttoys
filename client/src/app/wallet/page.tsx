'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowRight,
    ArrowDownLeft,
    ArrowDownToLine,
    ArrowUpFromLine,
    ArrowUpRight,
    Check,
    ChevronLeft,
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
type SendStep = 'input' | 'confirm';

const QUICK_AMOUNTS = [5000, 10000, 25000, 50000, 100000];
const HISTORY_PAGE_SIZE = 20;
const WALLET_SEND_FEE = 71;
const WALLET_FRIENDLY_BODY_LENGTH = 12;
const TELEGRAM_USERNAME_MAX_LENGTH = 32;
const SEND_LOOKUP_DEBOUNCE_MS = 420;
const MAX_AMOUNT_INPUT_DIGITS = 11;
const SEND_MEMO_MAX_LENGTH = 180;
const SWIPE_TRACK_HORIZONTAL_PADDING = 6;
const SWIPE_HANDLE_SIZE = 44;
const SWIPE_COMPLETE_THRESHOLD = 0.92;

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

function sanitizeSendMemo(value: string): string {
    return value.slice(0, SEND_MEMO_MAX_LENGTH);
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
    const [sendStep, setSendStep] = useState<SendStep>('input');
    const [sendMemoInput, setSendMemoInput] = useState('');
    const [recipientLookup, setRecipientLookup] = useState<RecipientLookupResult | null>(null);
    const lookupSeqRef = useRef(0);
    const sendSwipeTrackRef = useRef<HTMLDivElement | null>(null);
    const sendSwipePointerIdRef = useRef<number | null>(null);
    const sendSwipeStartXRef = useRef(0);
    const sendSwipeStartOffsetRef = useRef(0);
    const [sendSwipeOffset, setSendSwipeOffset] = useState(0);
    const [sendSwipeMaxOffset, setSendSwipeMaxOffset] = useState(0);
    const [isSendSwiping, setIsSendSwiping] = useState(false);

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

        const source = sanitizeFriendlyBody(recipientLookup?.walletFriendly || '');
        if (!source) {
            return '';
        }

        return `LV-${source}`;
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
    const sendRecipientByUsername = recipientType === 'username' ? normalizedUsername : '';
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
        : `LV-${normalizedWalletBody}`;
    const sendMemoLength = sendMemoInput.length;

    const recalculateSendSwipeBounds = useCallback(() => {
        const trackElement = sendSwipeTrackRef.current;
        if (!trackElement) {
            setSendSwipeMaxOffset(0);
            return;
        }

        const nextMaxOffset = Math.max(
            0,
            trackElement.clientWidth - (SWIPE_TRACK_HORIZONTAL_PADDING * 2) - SWIPE_HANDLE_SIZE,
        );
        setSendSwipeMaxOffset(nextMaxOffset);
        setSendSwipeOffset((current) => Math.min(current, nextMaxOffset));
    }, []);

    useEffect(() => {
        if (drawerMode !== 'send' || sendStep !== 'confirm') {
            setSendSwipeOffset(0);
            setSendSwipeMaxOffset(0);
            setIsSendSwiping(false);
            sendSwipePointerIdRef.current = null;
            sendSwipeStartXRef.current = 0;
            sendSwipeStartOffsetRef.current = 0;
            return;
        }

        const frameId = window.requestAnimationFrame(recalculateSendSwipeBounds);
        const handleResize = () => {
            recalculateSendSwipeBounds();
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('resize', handleResize);
        };
    }, [drawerMode, recalculateSendSwipeBounds, sendStep]);

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

        if (mode === 'send') {
            setSendStep('input');
            setSendSwipeOffset(0);
            setSendSwipeMaxOffset(0);
            setIsSendSwiping(false);
            sendSwipePointerIdRef.current = null;
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
        setCopiedInDrawer(false);
        setIsSendSwiping(false);
        sendSwipePointerIdRef.current = null;
        setSendSwipeOffset(0);
        setSendSwipeMaxOffset(0);

        if (drawerMode !== 'send') {
            setAmountInput('');
            setSelectedQuick(null);
        }
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
        setSendStep('confirm');
        setSendSwipeOffset(0);
        setSendSwipeMaxOffset(0);
        setIsSendSwiping(false);
        sendSwipePointerIdRef.current = null;
        haptic.impact('light');
    };

    const handleBackFromSendConfirm = () => {
        if (isSubmitting) {
            return;
        }

        setSendStep('input');
        setDrawerError('');
        setIsSendSwiping(false);
        sendSwipePointerIdRef.current = null;
        setSendSwipeOffset(0);
        setSendSwipeMaxOffset(0);
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
                    : { toAddress: `LV-${payload.recipientByWallet}` }),
                ...(trimmedMemo ? { memo: trimmedMemo } : {}),
            });

            await Promise.all([
                loadWallet(),
                loadHistory({ cursor: null, append: false }),
            ]);

            haptic.success();
            setSendStep('input');
            setSendMemoInput('');
            setRecipientType('username');
            setUsernameInput('');
            setWalletBodyInput('');
            setRecipientLookup(null);
            setAmountInput('');
            closeDrawer(true);
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
        closeDrawer,
    ]);

    const handleSendSwipePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (drawerMode !== 'send' || sendStep !== 'confirm' || isSubmitting || sendSwipeMaxOffset <= 0) {
            return;
        }

        event.preventDefault();
        sendSwipePointerIdRef.current = event.pointerId;
        sendSwipeStartXRef.current = event.clientX;
        sendSwipeStartOffsetRef.current = sendSwipeOffset;
        setIsSendSwiping(true);
        setDrawerError('');
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleSendSwipePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (sendSwipePointerIdRef.current !== event.pointerId || isSubmitting) {
            return;
        }

        event.preventDefault();
        const deltaX = event.clientX - sendSwipeStartXRef.current;
        const nextOffset = Math.min(sendSwipeMaxOffset, Math.max(0, sendSwipeStartOffsetRef.current + deltaX));
        setSendSwipeOffset(nextOffset);
    };

    const finalizeSendSwipe = async (event: React.PointerEvent<HTMLButtonElement>) => {
        if (sendSwipePointerIdRef.current !== event.pointerId) {
            return;
        }

        event.preventDefault();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        sendSwipePointerIdRef.current = null;
        setIsSendSwiping(false);

        if (isSubmitting) {
            return;
        }

        const reachedEnd = sendSwipeMaxOffset > 0 && sendSwipeOffset >= (sendSwipeMaxOffset * SWIPE_COMPLETE_THRESHOLD);
        if (!reachedEnd) {
            setSendSwipeOffset(0);
            haptic.selection();
            return;
        }

        setSendSwipeOffset(sendSwipeMaxOffset);
        const succeeded = await handleApplySend();
        if (!succeeded) {
            setSendSwipeOffset(0);
        }
    };

    const handleSendSwipePointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (sendSwipePointerIdRef.current !== event.pointerId) {
            return;
        }

        event.preventDefault();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        sendSwipePointerIdRef.current = null;
        setIsSendSwiping(false);
        if (isSubmitting) {
            return;
        }
        setSendSwipeOffset(0);
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
                            <button
                                type="button"
                                className={styles.closeButton}
                                onClick={drawerMode === 'send' && sendStep === 'confirm'
                                    ? handleBackFromSendConfirm
                                    : () => closeDrawer()}
                            >
                                {drawerMode === 'send' && sendStep === 'confirm' ? <ChevronLeft size={16} /> : <X size={16} />}
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
                                {sendStep === 'input' ? (
                                    <>
                                        <div className={styles.sendTabs}>
                                            <button
                                                type="button"
                                                className={`${styles.sendTab} ${recipientType === 'username' ? styles.sendTabActive : ''}`}
                                                onClick={() => {
                                                    setRecipientType('username');
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
                                                    setDrawerError('');
                                                    haptic.selection();
                                                }}
                                            >
                                                {t('wallet') || 'Wallet'}
                                            </button>
                                        </div>

                                        {recipientType === 'wallet' && suggestedWallet && (
                                            <button
                                                type="button"
                                                className={styles.sendWalletSuggestion}
                                                onClick={() => {
                                                    setWalletBodyInput(sanitizeFriendlyBody(suggestedWallet.replace(/^LV-/i, '')));
                                                    setDrawerError('');
                                                    haptic.selection();
                                                }}
                                            >
                                                <span className={styles.sendWalletSuggestionAvatarWrap}>
                                                    {recipientLookup?.photoUrl ? (
                                                        <img
                                                            src={recipientLookup.photoUrl}
                                                            alt=""
                                                            className={styles.sendWalletSuggestionAvatar}
                                                            loading="lazy"
                                                            referrerPolicy="no-referrer"
                                                        />
                                                    ) : (
                                                        <span className={styles.sendWalletSuggestionAvatarFallback}>@</span>
                                                    )}
                                                </span>
                                                <span className={styles.sendWalletSuggestionMeta}>
                                                    <span className={styles.sendWalletSuggestionName}>
                                                        {suggestionDisplayName}
                                                    </span>
                                                    <span className={styles.sendWalletSuggestionAddress}>{suggestedWallet}</span>
                                                </span>
                                            </button>
                                        )}

                                        <div className={styles.sendField}>
                                            <div className={styles.sendInputWrap}>
                                                {recipientType === 'username' ? (
                                                    <span className={styles.sendPrefixSlot}>
                                                        {hasExactUsernameMatch && recipientLookup?.photoUrl ? (
                                                            <img
                                                                src={recipientLookup.photoUrl}
                                                                alt=""
                                                                className={styles.sendPrefixAvatar}
                                                                loading="lazy"
                                                                referrerPolicy="no-referrer"
                                                            />
                                                        ) : (
                                                            <span className={styles.sendPrefix}>@</span>
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
                                                        }
                                                        setDrawerError('');
                                                    }}
                                                />
                                            </div>
                                        </div>

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

                                        <div className={styles.confirmMeta}>
                                            <div className={styles.confirmFee}>
                                                <span className={styles.confirmFeeLabel}>{t('wallet_amount_label') || 'Amount'}</span>
                                                <span className={styles.confirmFeeValue}>
                                                    {parsedAmount ? `${formatCurrency(parsedAmount)} UZS` : '—'}
                                                </span>
                                            </div>
                                            <div className={styles.confirmFee}>
                                                <span className={styles.confirmFeeLabel}>{t('wallet_send_fee_label') || 'Fee'}</span>
                                                <span className={styles.confirmFeeValue}>{formatCurrency(WALLET_SEND_FEE)} UZS</span>
                                            </div>
                                            <div className={styles.confirmFee}>
                                                <span className={styles.confirmFeeLabel}>{t('wallet_send_total_label') || 'Total debit'}</span>
                                                <span className={styles.confirmFeeValue}>
                                                    {sendTotalDebit ? `${formatCurrency(sendTotalDebit)} UZS` : '—'}
                                                </span>
                                            </div>
                                        </div>

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
                                            <div className={styles.swipeTrack} ref={sendSwipeTrackRef}>
                                                <div
                                                    className={styles.swipeFill}
                                                    style={{ width: `${SWIPE_HANDLE_SIZE + sendSwipeOffset + (SWIPE_TRACK_HORIZONTAL_PADDING * 2)}px` }}
                                                />
                                                <span className={styles.swipeLabel}>
                                                    {t('transfer_swipe_confirm') || 'Confirm'}
                                                </span>
                                                <button
                                                    type="button"
                                                    className={`${styles.swipeHandle} ${isSendSwiping ? styles.swipeHandleActive : ''}`}
                                                    style={{ transform: `translateX(${sendSwipeOffset}px)` }}
                                                    onPointerDown={handleSendSwipePointerDown}
                                                    onPointerMove={handleSendSwipePointerMove}
                                                    onPointerUp={finalizeSendSwipe}
                                                    onPointerCancel={handleSendSwipePointerCancel}
                                                    disabled={isSubmitting}
                                                    aria-label={t('transfer_swipe_confirm') || 'Confirm'}
                                                >
                                                    {isSubmitting ? (
                                                        <Loader2 size={20} className={styles.swipeSpinner} />
                                                    ) : (
                                                        <ArrowRight size={20} />
                                                    )}
                                                </button>
                                            </div>
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
                    </section>
                </div>
            </div>
        </>
    );
}
