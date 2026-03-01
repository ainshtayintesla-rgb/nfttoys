'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IoArrowDown, IoArrowUp, IoFlame, IoFunnel, IoSparkles } from 'react-icons/io5';

import { BottomDrawer } from '@/components/ui/BottomDrawer';
import { DetailsTable } from '@/components/ui/DetailsTable';
import { TxCard } from '@/components/ui/TxCard';
import { api } from '@/lib/api';
import { Locale, useLanguage } from '@/lib/context/LanguageContext';
import { useTelegram } from '@/lib/context/TelegramContext';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';
import { TgsPlayer } from '@/components/ui/TgsPlayer';

import styles from './page.module.css';

type QuickPresetId = 'week' | 'threeDays' | 'month' | 'year';

type Direction = 'in' | 'out';
type TxDisplayKind = 'received' | 'sent' | 'minted' | 'burn';

interface PartyInfo {
    id: string;
    username: string | null;
    firstName: string | null;
    photoUrl: string | null;
}

interface TransactionItem {
    id: string;
    txHash: string;
    type: string;
    direction: Direction;
    amount: number;
    asset: string;
    from: string | null;
    fromFriendly: string | null;
    fromUser: PartyInfo | null;
    to: string | null;
    toFriendly: string | null;
    toUser: PartyInfo | null;
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

interface DateRange {
    from: string;
    to: string;
}

interface DateGroup {
    key: string;
    label: string;
    items: TransactionItem[];
}

const DEFAULT_PRESET: QuickPresetId = 'month';

function toInputDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getPresetRange(preset: QuickPresetId): DateRange {
    const end = new Date();
    const start = new Date(end);

    if (preset === 'threeDays') {
        start.setDate(end.getDate() - 2);
    } else if (preset === 'week') {
        start.setDate(end.getDate() - 6);
    } else if (preset === 'month') {
        start.setMonth(end.getMonth() - 1);
    } else {
        start.setFullYear(end.getFullYear() - 1);
    }

    return {
        from: toInputDate(start),
        to: toInputDate(end),
    };
}

function toLocaleCode(locale: Locale): string {
    if (locale === 'ru') return 'ru-RU';
    if (locale === 'uz') return 'uz-UZ';
    return 'en-US';
}

function formatGroupDate(dateKey: string, locale: Locale): string {
    const [yearRaw, monthRaw, dayRaw] = dateKey.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);

    if (!year || !month || !day) {
        return dateKey;
    }

    const date = new Date(year, month - 1, day);
    const currentYear = new Date().getFullYear();
    const localeCode = toLocaleCode(locale);
    const includeYear = year !== currentYear;

    return new Intl.DateTimeFormat(localeCode, {
        day: 'numeric',
        month: 'long',
        ...(includeYear ? { year: 'numeric' } : {}),
    }).format(date);
}

function formatTime(value: string, locale: Locale): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }

    return new Intl.DateTimeFormat(toLocaleCode(locale), {
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function formatDetailsDate(value: string, locale: Locale): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    const includeYear = date.getFullYear() !== new Date().getFullYear();

    return new Intl.DateTimeFormat(toLocaleCode(locale), {
        day: 'numeric',
        month: 'short',
        ...(includeYear ? { year: 'numeric' } : {}),
    }).format(date);
}

function dateKeyFromTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return 'invalid-date';
    }

    return toInputDate(date);
}

function toComparableDate(value: string): Date | null {
    if (!value) {
        return null;
    }

    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

function isMintLikeType(type: string): boolean {
    const normalized = type.trim().toLowerCase();
    return normalized === 'mint' || normalized === 'minted' || normalized === 'activated';
}

function isBurnType(type: string): boolean {
    const normalized = type.trim().toLowerCase();
    return normalized === 'burn' || normalized === 'burned';
}

function resolveDisplayKind(item: Pick<TransactionItem, 'type' | 'direction'>): TxDisplayKind {
    if (isBurnType(item.type)) {
        return 'burn';
    }

    if (isMintLikeType(item.type)) {
        return 'minted';
    }

    return item.direction === 'in' ? 'received' : 'sent';
}

function formatWalletLabel(address: string | null): string {
    if (!address) {
        return '—';
    }

    const normalized = address.trim();
    if (!normalized) {
        return '—';
    }

    const tail = normalized.toUpperCase().slice(-6);
    if (!tail) {
        return '—';
    }

    return `LV-...${tail}`;
}

export default function TransactionsPage() {
    const router = useRouter();
    const { locale, t } = useLanguage();
    const { webApp, haptic } = useTelegram();

    const [transactions, setTransactions] = useState<TransactionItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [activeRange, setActiveRange] = useState<DateRange>(() => getPresetRange(DEFAULT_PRESET));
    const [activePreset, setActivePreset] = useState<QuickPresetId | null>(DEFAULT_PRESET);

    const [draftRange, setDraftRange] = useState<DateRange>(() => getPresetRange(DEFAULT_PRESET));
    const [draftPreset, setDraftPreset] = useState<QuickPresetId | null>(DEFAULT_PRESET);
    const [draftError, setDraftError] = useState<string>('');

    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [selectedTransaction, setSelectedTransaction] = useState<TransactionItem | null>(null);

    const filterTouchStartY = useRef<number | null>(null);
    const filterTouchCurrentY = useRef<number | null>(null);
    const detailsTouchStartY = useRef<number | null>(null);
    const detailsTouchCurrentY = useRef<number | null>(null);
    const isFilterOpenRef = useRef(false);
    const hasSelectedTransactionRef = useRef(false);

    useBodyScrollLock(isFilterOpen || Boolean(selectedTransaction));

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
        isFilterOpenRef.current = isFilterOpen;
    }, [isFilterOpen]);

    useEffect(() => {
        hasSelectedTransactionRef.current = Boolean(selectedTransaction);
    }, [selectedTransaction]);

    const loadTransactions = useCallback(async (range: DateRange) => {
        setIsLoading(true);
        setError(null);

        try {
            const response = await api.transactions.list({
                from: range.from,
                to: range.to,
                limit: 200,
            });

            setTransactions(response.transactions || []);
        } catch (loadError) {
            setTransactions([]);
            setError(loadError instanceof Error ? loadError.message : (t('error_occurred') || 'Error'));
        } finally {
            setIsLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void loadTransactions(activeRange);
    }, [activeRange, loadTransactions]);

    const closeFilter = useCallback(() => {
        isFilterOpenRef.current = false;
        setIsFilterOpen(false);
        setDraftError('');
    }, []);

    const closeDetails = useCallback(() => {
        hasSelectedTransactionRef.current = false;
        setSelectedTransaction(null);
    }, []);

    const handleBack = useCallback(() => {
        if (hasSelectedTransactionRef.current) {
            closeDetails();
            return;
        }

        if (isFilterOpenRef.current) {
            closeFilter();
            return;
        }

        haptic.impact('light');
        if (window.history.length > 1) {
            router.back();
            return;
        }

        router.push('/profile');
    }, [closeDetails, closeFilter, haptic, router]);

    useEffect(() => {
        const backButton = webApp?.BackButton;
        if (!backButton) {
            return;
        }

        backButton.show();
        backButton.onClick(handleBack);

        return () => {
            backButton.offClick(handleBack);
            backButton.hide();
        };
    }, [handleBack, webApp]);

    const groupedTransactions = useMemo<DateGroup[]>(() => {
        const grouped = new Map<string, TransactionItem[]>();

        transactions.forEach((item) => {
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
    }, [locale, t, transactions]);

    const openFilter = () => {
        haptic.selection();
        setDraftRange(activeRange);
        setDraftPreset(activePreset);
        setDraftError('');
        isFilterOpenRef.current = true;
        setIsFilterOpen(true);
    };

    const applyPreset = (preset: QuickPresetId) => {
        const nextRange = getPresetRange(preset);
        setDraftRange(nextRange);
        setDraftPreset(preset);
        setDraftError('');
        haptic.selection();
    };

    const handleDraftDateChange = (field: 'from' | 'to', value: string) => {
        setDraftRange((current) => ({
            ...current,
            [field]: value,
        }));
        setDraftPreset(null);
        setDraftError('');
    };

    const applyFilter = () => {
        const fromDate = toComparableDate(draftRange.from);
        const toDate = toComparableDate(draftRange.to);

        if (!fromDate || !toDate) {
            setDraftError(t('transactions_invalid_date') || 'Invalid date range');
            return;
        }

        if (fromDate.getTime() > toDate.getTime()) {
            setDraftError(t('transactions_invalid_date') || 'Invalid date range');
            return;
        }

        haptic.impact('light');
        setActiveRange(draftRange);
        setActivePreset(draftPreset);
        closeFilter();
    };

    const resetFilter = () => {
        const resetRange = getPresetRange(DEFAULT_PRESET);

        haptic.impact('light');
        setDraftRange(resetRange);
        setDraftPreset(DEFAULT_PRESET);
        setDraftError('');
        setActiveRange(resetRange);
        setActivePreset(DEFAULT_PRESET);
        closeFilter();
    };

    const handleCardClick = (item: TransactionItem) => {
        haptic.impact('light');
        hasSelectedTransactionRef.current = true;
        setSelectedTransaction(item);
    };

    const filterSwipeHandlers = {
        onTouchStart: (event: React.TouchEvent<HTMLDivElement>) => {
            filterTouchStartY.current = event.touches[0]?.clientY ?? null;
            filterTouchCurrentY.current = filterTouchStartY.current;
        },
        onTouchMove: (event: React.TouchEvent<HTMLDivElement>) => {
            filterTouchCurrentY.current = event.touches[0]?.clientY ?? null;
        },
        onTouchEnd: () => {
            const startY = filterTouchStartY.current;
            const currentY = filterTouchCurrentY.current;

            filterTouchStartY.current = null;
            filterTouchCurrentY.current = null;

            if (startY === null || currentY === null) {
                return;
            }

            if (currentY - startY > 72) {
                closeFilter();
            }
        },
    };

    const detailsSwipeHandlers = {
        onTouchStart: (event: React.TouchEvent<HTMLDivElement>) => {
            detailsTouchStartY.current = event.touches[0]?.clientY ?? null;
            detailsTouchCurrentY.current = detailsTouchStartY.current;
        },
        onTouchMove: (event: React.TouchEvent<HTMLDivElement>) => {
            detailsTouchCurrentY.current = event.touches[0]?.clientY ?? null;
        },
        onTouchEnd: () => {
            const startY = detailsTouchStartY.current;
            const currentY = detailsTouchCurrentY.current;

            detailsTouchStartY.current = null;
            detailsTouchCurrentY.current = null;

            if (startY === null || currentY === null) {
                return;
            }

            if (currentY - startY > 72) {
                closeDetails();
            }
        },
    };

    const quickButtons: Array<{ id: QuickPresetId; label: string }> = [
        { id: 'week', label: t('transactions_quick_week') || '1 week' },
        { id: 'threeDays', label: t('transactions_quick_three_days') || '3 days' },
        { id: 'month', label: t('transactions_quick_month') || '1 month' },
        { id: 'year', label: t('transactions_quick_year') || '1 year' },
    ];

    const getDirectionLabel = useCallback((kind: TxDisplayKind) => {
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
    const getKindClassName = useCallback((kind: TxDisplayKind) => {
        if (kind === 'burn') {
            return styles.kindBurn;
        }

        if (kind === 'minted') {
            return styles.kindMinted;
        }

        if (kind === 'received') {
            return styles.kindReceived;
        }

        return styles.kindSent;
    }, []);
    const getKindIcon = useCallback((kind: TxDisplayKind, size = 18) => {
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

    const selectedKind = selectedTransaction ? resolveDisplayKind(selectedTransaction) : null;
    const selectedTitle = selectedTransaction?.collectionName
        || selectedTransaction?.modelName
        || (t('transactions_asset_nft') || 'NFT');
    const selectedSerial = selectedTransaction?.serialNumber ? `#${selectedTransaction.serialNumber}` : '';
    const selectedDateLabel = selectedTransaction ? formatDetailsDate(selectedTransaction.timestamp, locale) : '—';
    const selectedTimeLabel = selectedTransaction ? formatTime(selectedTransaction.timestamp, locale) : '—';

    const selectedAddress = useMemo(() => {
        if (!selectedTransaction || !selectedKind) {
            return null;
        }

        if (selectedKind === 'sent') {
            return selectedTransaction.toFriendly || selectedTransaction.to;
        }

        if (selectedKind === 'received') {
            return selectedTransaction.fromFriendly || selectedTransaction.from;
        }

        if (selectedKind === 'burn') {
            return selectedTransaction.toFriendly || selectedTransaction.to;
        }

        return selectedTransaction.fromFriendly || selectedTransaction.from;
    }, [selectedKind, selectedTransaction]);

    const lowerTableLabel = useMemo(() => {
        if (!selectedKind) {
            return '';
        }

        if (selectedKind === 'sent') {
            return t('transactions_recipient') || 'Recipient';
        }

        if (selectedKind === 'received') {
            return t('transactions_sender') || 'Sender';
        }

        if (selectedKind === 'burn') {
            return t('transactions_burn_address') || 'Burn address';
        }

        return t('transactions_source') || 'Source';
    }, [selectedKind, t]);

    const lowerTableAddressValue = selectedAddress
        ? formatWalletLabel(selectedAddress)
        : (t('system') || 'System');
    const selectedMemo = (selectedTransaction?.memo || '').trim();
    const shouldShowMemoDetails = selectedMemo.length > 0;
    const selectedFeeValue = selectedTransaction?.fee || '741 UZS';
    const selectedNameLine = `${selectedTitle}${selectedSerial ? ` ${selectedSerial}` : ''}`;
    const selectedDateTimeLine = `${selectedDateLabel}, ${selectedTimeLabel}`;
    const selectedIcon = selectedKind ? getKindIcon(selectedKind) : <IoArrowUp size={18} />;

    return (
        <div className={styles.container}>
            <main className={styles.main}>
                <header className={styles.header}>
                    <h1>{t('transactions_title') || 'Транзакции'}</h1>
                    <button
                        type="button"
                        className={styles.filterButton}
                        onClick={openFilter}
                        aria-label={t('transactions_filter') || 'Filter'}
                    >
                        <IoFunnel size={18} />
                    </button>
                </header>

                {isLoading && (
                    <section className={styles.skeletonList}>
                        {[0, 1, 2, 3, 4, 5].map((index) => (
                            <div key={index} className={styles.skeletonItem}></div>
                        ))}
                    </section>
                )}

                {!isLoading && error && (
                    <div className={styles.errorState}>{error}</div>
                )}

                {!isLoading && !error && groupedTransactions.length === 0 && (
                    <div className={styles.emptyState}>
                        {t('transactions_empty') || 'Нет транзакций за выбранный период'}
                    </div>
                )}

                {!isLoading && !error && groupedTransactions.length > 0 && (
                    <section className={styles.groupList}>
                        {groupedTransactions.map((group) => (
                            <div key={group.key} className={styles.groupSection}>
                                <h2 className={styles.groupTitle}>{group.label}</h2>
                                <div className={styles.cards}>
                                    {group.items.map((item) => {
                                        const displayKind = resolveDisplayKind(item);
                                        const counterpartAddress = displayKind === 'received' || displayKind === 'minted'
                                            ? (item.fromFriendly || item.from)
                                            : (item.toFriendly || item.to);
                                        const counterpartLabel = counterpartAddress
                                            ? formatWalletLabel(counterpartAddress)
                                            : (t('system') || 'System');
                                        const cardKindClassName = getKindClassName(displayKind);
                                        const cardDateTimeLine = `${formatDetailsDate(item.timestamp, locale)}, ${formatTime(item.timestamp, locale)}`;

                                        return (
                                            <TxCard
                                                key={item.id}
                                                className={styles.card}
                                                onClick={() => handleCardClick(item)}
                                                icon={getKindIcon(displayKind, 22)}
                                                iconWrapClassName={`${styles.kindIcon} ${cardKindClassName}`}
                                                title={getDirectionLabel(displayKind)}
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
            </main>

            <BottomDrawer
                open={isFilterOpen}
                onClose={closeFilter}
                title={t('transactions_filter') || 'Filter'}
                closeAriaLabel={t('transactions_close') || 'Close'}
                overlayClassName={styles.sidebarOverlay}
                drawerClassName={`${styles.sidebar} ${styles.filterSidebar}`}
                bodyClassName={styles.sidebarBody}
                drawerProps={filterSwipeHandlers}
                footer={(
                    <div className={styles.sidebarActions}>
                        <button type="button" className={styles.resetButton} onClick={resetFilter}>
                            {t('transactions_reset') || 'Reset'}
                        </button>
                        <button type="button" className={styles.applyButton} onClick={applyFilter}>
                            {t('transactions_apply') || 'Apply'}
                        </button>
                    </div>
                )}
            >
                <div className={styles.quickGrid}>
                    {quickButtons.map((preset) => (
                        <button
                            key={preset.id}
                            type="button"
                            className={`${styles.quickButton} ${draftPreset === preset.id ? styles.quickButtonActive : ''}`}
                            onClick={() => applyPreset(preset.id)}
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>

                <div className={styles.dateFields}>
                    <label className={styles.dateField}>
                        <span>{t('transactions_from') || 'От'}</span>
                        <input
                            type="date"
                            value={draftRange.from}
                            onChange={(event) => handleDraftDateChange('from', event.target.value)}
                        />
                    </label>

                    <label className={styles.dateField}>
                        <span>{t('transactions_to') || 'До'}</span>
                        <input
                            type="date"
                            value={draftRange.to}
                            onChange={(event) => handleDraftDateChange('to', event.target.value)}
                        />
                    </label>
                </div>

                {draftError && <p className={styles.sidebarError}>{draftError}</p>}
            </BottomDrawer>

            <BottomDrawer
                open={Boolean(selectedTransaction)}
                onClose={closeDetails}
                title={t('transactions_details') || 'Transfer details'}
                closeAriaLabel={t('transactions_close') || 'Close'}
                overlayClassName={`${styles.sidebarOverlay} ${styles.detailsOverlay}`}
                drawerClassName={`${styles.sidebar} ${styles.detailsSidebar}`}
                bodyClassName={styles.sidebarBodyPlain}
                drawerProps={detailsSwipeHandlers}
            >
                {selectedTransaction && (
                    <div className={`${styles.sidebarBody} ${styles.detailsBody}`}>
                        <section className={styles.detailsTop}>
                            <div className={styles.detailsAnimation}>
                                {selectedTransaction.tgsUrl ? (
                                    <TgsPlayer
                                        src={selectedTransaction.tgsUrl}
                                        style={{ width: 100, height: 100 }}
                                        autoplay
                                        loop={false}
                                        renderer="svg"
                                        unstyled
                                    />
                                ) : (
                                    <div className={styles.detailsAnimationFallback}>
                                        {selectedIcon}
                                    </div>
                                )}
                            </div>
                            <h4 className={styles.detailsName}>{selectedNameLine}</h4>
                            <div className={styles.detailsTypeDate}>
                                <span className={styles.summaryAsset}>{t('transactions_asset_nft') || 'NFT'}</span>
                                <span className={styles.summaryDate}>{selectedDateTimeLine}</span>
                            </div>
                        </section>

                        <section className={styles.detailsBottom}>
                            <DetailsTable
                                className={styles.detailsTable}
                                rowClassName={styles.detailsRow}
                                keyClassName={styles.detailsKey}
                                valueClassName={styles.detailsValue}
                                monoValueClassName={styles.detailsValueMono}
                                rows={[
                                    {
                                        id: 'counterparty',
                                        label: lowerTableLabel,
                                        value: lowerTableAddressValue,
                                        mono: true,
                                    },
                                    {
                                        id: 'fee',
                                        label: t('transactions_fee') || 'Fee',
                                        value: selectedFeeValue,
                                        hidden: !shouldShowMemoDetails,
                                    },
                                    {
                                        id: 'memo',
                                        label: t('transactions_comment') || t('transactions_memo') || 'Comment',
                                        value: selectedMemo,
                                        hidden: !shouldShowMemoDetails,
                                    },
                                ]}
                            />
                        </section>
                    </div>
                )}
            </BottomDrawer>
        </div>
    );
}
