'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    IoCheckmarkCircle,
    IoCube,
    IoFlame,
    IoLayers,
    IoRefresh,
    IoShareSocial,
    IoSparkles,
    IoStar,
    IoTime,
    IoTrendingUp,
} from 'react-icons/io5';

import { BottomDrawer } from '@/components/ui/BottomDrawer';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { TelegramBackButton } from '@/components/ui/TelegramBackButton';
import { TgsPlayer } from '@/components/ui/TgsPlayer';
import { api } from '@/lib/api';
import { API_BASE_URL } from '@/lib/apiBaseUrl';
import { useLanguage } from '@/lib/context/LanguageContext';
import { useTelegram } from '@/lib/context/TelegramContext';
import type { WalletV2NftStakingStateData, WalletV2NftStoryShareStateData } from '@/lib/walletV2/api';
import { isWalletV2ApiError } from '@/lib/walletV2/errors';
import { resetWalletV2ClientAuthState } from '@/lib/walletV2/sessionLifecycle';

import styles from './page.module.css';

type NftStakingActionType = 'stake' | 'claim' | 'unstake';

function formatIntegerString(value: string): string {
    const normalized = value.trim().replace(/^0+(?=\d)/, '') || '0';
    return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function localeToIntlCode(locale: string): string {
    if (locale === 'ru') return 'ru-RU';
    if (locale === 'uz') return 'uz-UZ';
    return 'en-US';
}

function formatDateTime(value: string, locale: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(localeToIntlCode(locale), {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function safeErrorMessage(error: unknown): string {
    if (isWalletV2ApiError(error)) {
        if (error.code === 'TOKEN_ID_REQUIRED') return 'Token id is required.';
        if (error.code === 'NFT_NOT_FOUND') return 'NFT not found.';
        if (error.code === 'NFT_NOT_OWNED') return 'This NFT is not linked to the current wallet profile.';
        if (error.code === 'NFT_ALREADY_STAKED') return 'NFT is already staked.';
        if (error.code === 'NFT_UNAVAILABLE') return 'NFT is not available for staking.';
        if (error.code === 'STAKE_WINDOW_NOT_OPEN') return 'Staking window is not open yet for this NFT.';
        if (error.code === 'STAKE_WINDOW_CLOSED') return 'Staking window is closed for this NFT.';
        if (error.code === 'NO_REWARD_AVAILABLE') return 'No staking reward available yet.';
        if (error.code === 'STAKE_POSITION_NOT_FOUND') return 'Staking position not found.';
        if (error.code === 'UNSTAKE_COOLDOWN_ACTIVE') return 'NFT is still in unstake cooldown period.';
        if (error.code === 'WALLET_SESSION_MISSING' || error.code === 'SESSION_REVOKED') return 'Wallet session is missing. Open Wallet V2 and authenticate again.';
        if (error.code === 'WALLET_NOT_FOUND') return 'Wallet was not found on server. Create or import wallet again.';
        if (error.code === 'NFT_STAKING_SCHEMA_NOT_READY') return 'NFT staking is not initialized on server. Apply latest migrations, regenerate Prisma client, and restart backend.';
        if (error.message) return error.message;
    }
    if (error instanceof Error && error.message) return error.message;
    return 'Request failed';
}

function getRarityBadgeClass(rarity: string | null, styleMap: Record<string, string>): string | null {
    const r = (rarity || '').toLowerCase();
    if (r === 'legendary') return styleMap.itemBadge;
    if (r === 'rare') return styleMap.itemBadgeBlue;
    return null;
}

function getRarityIcon(rarity: string | null, size: number): React.ReactNode {
    const r = (rarity || '').toLowerCase();
    if (r === 'legendary') return <IoFlame size={size} />;
    if (r === 'rare') return <IoStar size={size} />;
    return <IoCube size={size} />;
}

export default function WalletV2StakingPage() {
    const { t, locale } = useLanguage();
    const { haptic, webApp } = useTelegram();
    const router = useRouter();

    const tr = useCallback((key: string, fallback: string): string => {
        const value = t(key as never);
        return value === key ? fallback : value;
    }, [t]);

    const [walletId, setWalletId] = useState<string | null>(() => api.walletV2.session.getWalletId());
    const [nftStakingState, setNftStakingState] = useState<WalletV2NftStakingStateData | null>(null);
    const [isNftStakingLoading, setIsNftStakingLoading] = useState(false);
    const [nftStakingError, setNftStakingError] = useState('');
    const [requestSuccess, setRequestSuccess] = useState('');
    const [nftStakingActionTokenId, setNftStakingActionTokenId] = useState<string | null>(null);
    const [nftStakingActionType, setNftStakingActionType] = useState<NftStakingActionType | null>(null);

    const stakingPositions = nftStakingState?.positions || [];
    const stakingAvailable = nftStakingState?.available || [];
    const stakingRewardAsset = nftStakingState?.rewardAsset || 'UZS';

    const stakingSummaryPending = useMemo(() => {
        return formatIntegerString(nftStakingState?.summary?.pendingReward || '0');
    }, [nftStakingState?.summary?.pendingReward]);

    const stakingSummaryClaimed = useMemo(() => {
        return formatIntegerString(nftStakingState?.summary?.totalClaimed || '0');
    }, [nftStakingState?.summary?.totalClaimed]);

    const stakingWindowHint = useMemo(() => {
        if (!nftStakingState?.rules) return 'Stake window: 24–48h after incoming transfer';
        return `Stake window: ${nftStakingState.rules.windowStartHours}–${nftStakingState.rules.windowEndHours}h after transfer`;
    }, [nftStakingState?.rules]);

    const loadNftStakingState = useCallback(async (showLoader = true) => {
        if (!walletId) {
            setNftStakingState(null);
            setIsNftStakingLoading(false);
            setNftStakingError('Wallet session is missing');
            return;
        }
        if (showLoader) setIsNftStakingLoading(true);
        setNftStakingError('');
        try {
            const response = await api.walletV2.nftStaking.state(walletId);
            setNftStakingState(response);
        } catch (error) {
            setNftStakingError(safeErrorMessage(error));
        } finally {
            if (showLoader) setIsNftStakingLoading(false);
        }
    }, [walletId]);

    const runNftStakingAction = useCallback(async (tokenId: string, action: NftStakingActionType) => {
        if (!walletId || !tokenId.trim()) return;
        setNftStakingActionTokenId(tokenId);
        setNftStakingActionType(action);
        setNftStakingError('');
        setRequestSuccess('');
        try {
            if (action === 'stake') {
                await api.walletV2.nftStaking.stake({ walletId, tokenId });
                setRequestSuccess('NFT staked successfully.');
            } else if (action === 'claim') {
                await api.walletV2.nftStaking.claim({ walletId, tokenId });
                setRequestSuccess('Staking reward claimed.');
            } else {
                await api.walletV2.nftStaking.unstake({ walletId, tokenId, claimRewards: true });
                setRequestSuccess('NFT unstaked successfully.');
            }
            await loadNftStakingState(false);
            haptic.success();
        } catch (error) {
            setNftStakingError(safeErrorMessage(error));
            haptic.error();
        } finally {
            setNftStakingActionTokenId(null);
            setNftStakingActionType(null);
        }
    }, [haptic, loadNftStakingState, walletId]);

    // ─── Story share state ─────────────────────────────────────────────────
    const [storyShareStates, setStoryShareStates] = useState<Record<string, WalletV2NftStoryShareStateData>>({});
    const [storyShareLoadingTokenId, setStoryShareLoadingTokenId] = useState<string | null>(null);

    const loadStoryShareState = useCallback(async (tokenId: string) => {
        if (!walletId) return;
        try {
            const state = await api.walletV2.nftStaking.storyShareState({ walletId, tokenId });
            setStoryShareStates((prev) => ({ ...prev, [tokenId]: state }));
        } catch {
            // Story share is optional
        }
    }, [walletId]);

    useEffect(() => {
        if (!walletId || stakingPositions.length === 0) return;
        stakingPositions.forEach((pos) => { void loadStoryShareState(pos.tokenId); });
    }, [loadStoryShareState, stakingPositions, walletId]);

    // ─── Story share drawer ────────────────────────────────────────────────
    const [storyDrawerOpen, setStoryDrawerOpen] = useState(false);
    const [storyDrawerTokenId, setStoryDrawerTokenId] = useState<string | null>(null);
    const [storyDrawerAgreed, setStoryDrawerAgreed] = useState(false);
    const [storyDrawerStep, setStoryDrawerStep] = useState<'rules' | 'sharing' | 'verifying'>('rules');
    const [storyDrawerCode, setStoryDrawerCode] = useState('');

    const openStoryDrawer = useCallback((tokenId: string) => {
        setStoryDrawerTokenId(tokenId);
        setStoryDrawerAgreed(false);
        setStoryDrawerStep('rules');
        setStoryDrawerCode('');
        setStoryDrawerOpen(true);
        void loadStoryShareState(tokenId);
    }, [loadStoryShareState]);

    const closeStoryDrawer = useCallback(() => {
        setStoryDrawerOpen(false);
        setStoryDrawerTokenId(null);
        setStoryDrawerStep('rules');
        setStoryDrawerCode('');
    }, []);

    const handleShareStory = useCallback(async () => {
        if (!walletId || !webApp?.shareToStory || !storyDrawerTokenId) return;
        const tokenId = storyDrawerTokenId;
        setStoryDrawerStep('sharing');
        setStoryShareLoadingTokenId(tokenId);
        setNftStakingError('');
        setRequestSuccess('');
        try {
            const result = await api.walletV2.nftStaking.storyShare({ walletId, tokenId });
            const code = result.verificationCode || '';
            setStoryDrawerCode(code);
            const apiBase = API_BASE_URL;
            const dynamicUrl = `${apiBase}/v2/story-card/${encodeURIComponent(result.shareId)}.png`;
            const staticUrl = `${apiBase}/v2/story-card-static.png`;
            let storyCardUrl = staticUrl;
            try {
                const probe = await fetch(dynamicUrl, { method: 'HEAD' });
                if (probe.ok) storyCardUrl = dynamicUrl;
            } catch { /* use static */ }
            const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
            webApp.shareToStory(storyCardUrl, {
                text: `NFTToys Staking Boost | ${code}`,
                widget_link: appUrl ? { url: appUrl, name: 'NFTToys' } : undefined,
            });
            setStoryDrawerStep('verifying');
            setRequestSuccess('');
            await Promise.all([loadNftStakingState(false), loadStoryShareState(tokenId)]);
            haptic.success();
        } catch (error) {
            if (isWalletV2ApiError(error) && error.code === 'STORY_ALREADY_SHARED_TODAY') {
                setNftStakingError('Already shared story for this NFT today. Try again later.');
            } else {
                setNftStakingError(safeErrorMessage(error));
            }
            haptic.error();
            closeStoryDrawer();
        } finally {
            setStoryShareLoadingTokenId(null);
        }
    }, [closeStoryDrawer, haptic, loadNftStakingState, loadStoryShareState, storyDrawerTokenId, walletId, webApp]);

    // ─── Session management ────────────────────────────────────────────────
    const resolveFatalSessionMessage = useCallback((error?: unknown): string => {
        if (isWalletV2ApiError(error) && error.code === 'WALLET_NOT_FOUND') {
            return tr('wallet_v2_wallet_missing_error', 'Wallet was not found on server. Create or import wallet again.');
        }
        return tr('wallet_v2_session_revoked_error', 'Wallet session was revoked. Authenticate and import wallet again.');
    }, [tr]);

    const applyFatalSessionReset = useCallback((error?: unknown) => {
        const currentWalletId = walletId || api.walletV2.session.getWalletId();
        const currentDeviceId = api.walletV2.session.getDeviceId();
        resetWalletV2ClientAuthState({
            walletId: currentWalletId,
            deviceId: currentDeviceId,
            clearAllWalletSettings: !currentWalletId,
        });
        setWalletId(null);
        setNftStakingState(null);
        setIsNftStakingLoading(false);
        setNftStakingActionTokenId(null);
        setNftStakingActionType(null);
        setRequestSuccess('');
        setNftStakingError(resolveFatalSessionMessage(error));
        router.replace('/wallet-v2');
    }, [resolveFatalSessionMessage, router, walletId]);

    useEffect(() => {
        const unsubscribe = api.walletV2.session.onRevoked((error) => { applyFatalSessionReset(error); });
        return unsubscribe;
    }, [applyFatalSessionReset]);

    useEffect(() => {
        if (!walletId) { setNftStakingState(null); return; }
        void loadNftStakingState(true);
    }, [loadNftStakingState, walletId]);

    return (
        <>
            <TelegramBackButton href="/wallet-v2" />

            <div className={styles.container}>
                <main className={styles.main}>

                    {/* ── Page header ──────────────────────────────────────────── */}
                    <section className={styles.pageHeader}>
                        <div className={styles.pageLeft}>
                            <div className={styles.pageIconWrap}>
                                <IoTrendingUp size={20} />
                            </div>
                            <div className={styles.pageTextWrap}>
                                <div className={styles.pageTitleWrap}>
                                    {nftStakingState && nftStakingState.summary.activeCount > 0 && (
                                        <span className={styles.pageBadge}>
                                            <IoFlame size={10} />
                                            {nftStakingState.summary.activeCount} active
                                        </span>
                                    )}
                                    <h1 className={styles.pageTitle}>
                                        {tr('wallet_v2_nft_staking_title', 'NFT Staking')}
                                    </h1>
                                </div>
                            </div>
                        </div>
                        <button
                            type="button"
                            className={styles.refreshButton}
                            onClick={() => { void loadNftStakingState(true); }}
                            disabled={isNftStakingLoading || !walletId}
                            aria-label={tr('wallet_v2_refresh', 'Refresh')}
                        >
                            <IoRefresh size={18} className={isNftStakingLoading ? styles.refreshSpinning : ''} />
                        </button>
                    </section>

                    {/* ── Status banners ───────────────────────────────────────── */}
                    {requestSuccess && <p className={styles.statusSuccess}>{requestSuccess}</p>}
                    {nftStakingError && <p className={styles.statusError}>{nftStakingError}</p>}

                    {/* ── No wallet ────────────────────────────────────────────── */}
                    {!walletId ? (
                        <div className={styles.emptyState}>
                            <IoLayers size={40} className={styles.emptyIcon} />
                            <p className={styles.emptyText}>
                                {tr('wallet_v2_error_session_missing', 'Wallet session is missing')}
                            </p>
                            <Button
                                variant="primary"
                                onClick={() => {
                                    haptic.selection();
                                    router.push('/wallet-v2');
                                }}
                            >
                                {tr('wallet_v2_open_wallet', 'Open Wallet V2')}
                            </Button>
                        </div>
                    ) : (
                        <>
                            {/* ── Skeleton loader ──────────────────────────────── */}
                            {isNftStakingLoading && !nftStakingState && (
                                <div className={styles.skeletonRow}>
                                    <div className={styles.summaryGrid}>
                                        <Skeleton className={styles.skeletonSummary} />
                                        <Skeleton className={styles.skeletonSummary} />
                                        <Skeleton className={styles.skeletonSummary} />
                                    </div>
                                    <Skeleton className={styles.skeletonItem} />
                                    <Skeleton className={styles.skeletonItem} />
                                    <Skeleton className={styles.skeletonItem} />
                                </div>
                            )}

                            {/* ── Main content ─────────────────────────────────── */}
                            {!isNftStakingLoading && nftStakingState && (
                                <div className={styles.content}>

                                    {/* Summary hero card */}
                                    <div className={styles.summaryHero}>
                                        <div>
                                            <p className={styles.summaryHeroLabel}>
                                                {tr('wallet_v2_staking_pending', 'Total pending')}
                                            </p>
                                            <p className={styles.summaryHeroValue}>
                                                {stakingSummaryPending} {stakingRewardAsset}
                                            </p>
                                        </div>
                                        <div className={styles.summaryHeroStats}>
                                            <div className={styles.summaryHeroStat}>
                                                <span className={styles.summaryCellLabel}>
                                                    {tr('wallet_v2_staking_active', 'Active')}
                                                </span>
                                                <strong className={styles.summaryCellValue}>
                                                    {nftStakingState.summary.activeCount}
                                                </strong>
                                            </div>
                                            <div className={styles.summaryHeroStat} style={{ textAlign: 'right' }}>
                                                <span className={styles.summaryCellLabel}>
                                                    {tr('wallet_v2_staking_claimed', 'Claimed')}
                                                </span>
                                                <strong className={styles.summaryCellValue}>
                                                    {stakingSummaryClaimed} {stakingRewardAsset}
                                                </strong>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Staked positions */}
                                    {stakingPositions.length > 0 && (
                                        <div className={styles.block}>
                                            <h4 className={styles.blockTitle}>
                                                {tr('wallet_v2_staking_positions', 'Staked now')}
                                            </h4>
                                            <div className={styles.list}>
                                                {stakingPositions.map((position) => {
                                                    const isAnyActionLoading = Boolean(nftStakingActionTokenId);
                                                    const isClaimLoading = nftStakingActionTokenId === position.tokenId && nftStakingActionType === 'claim';
                                                    const isUnstakeLoading = nftStakingActionTokenId === position.tokenId && nftStakingActionType === 'unstake';
                                                    const rarityBadgeClass = getRarityBadgeClass(position.rarity, styles);

                                                    return (
                                                        <div key={position.tokenId} className={styles.item}>
                                                            <div className={styles.itemHead}>
                                                                <div className={styles.itemIconWrap} style={{ overflow: 'hidden' }}>
                                                                    {position.tgsUrl ? (
                                                                        <TgsPlayer
                                                                            src={position.tgsUrl}
                                                                            style={{ width: 38, height: 38 }}
                                                                            autoplay={false}
                                                                            playOnTap
                                                                            unstyled
                                                                            cacheKey={position.tokenId}
                                                                        />
                                                                    ) : getRarityIcon(position.rarity, 18)}
                                                                </div>
                                                                <div className={styles.itemTextWrap}>
                                                                    <p className={styles.itemTitle}>
                                                                        {position.collectionName}
                                                                        {position.serialNumber ? ` #${position.serialNumber}` : ''}
                                                                    </p>
                                                                    {rarityBadgeClass && position.rarity && (
                                                                        <span className={rarityBadgeClass}>
                                                                            {position.rarity}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            <div className={styles.rewardStrip}>
                                                                <p className={styles.rewardStripRate}>
                                                                    +{formatIntegerString(position.rewardPerHour)} {stakingRewardAsset}/h
                                                                </p>
                                                                <p className={styles.rewardStripPending}>
                                                                    +{formatIntegerString(position.pendingReward)} {stakingRewardAsset}
                                                                </p>
                                                            </div>

                                                            <div className={styles.itemMeta}>
                                                                <p className={styles.meta}>
                                                                    {tr('wallet_v2_staked_at', 'Staked at')}: {formatDateTime(position.stakedAt, locale)}
                                                                </p>
                                                                {!position.canUnstake && (
                                                                    <p className={styles.meta}>
                                                                        {tr('wallet_v2_unstake_available', 'Unstake available')}: {formatDateTime(position.unstakeAvailableAt, locale)}
                                                                    </p>
                                                                )}
                                                                {!position.owned && (
                                                                    <p className={styles.metaWarning}>
                                                                        {tr('wallet_v2_staking_ownership_warning', 'NFT ownership changed. Claim is disabled.')}
                                                                    </p>
                                                                )}
                                                            </div>

                                                            {/* Story boost badge */}
                                                            {(() => {
                                                                const ssState = storyShareStates[position.tokenId];
                                                                if (!ssState?.activeBoost) return null;
                                                                const expires = new Date(ssState.activeBoost.boostExpiresAt);
                                                                const hoursLeft = Math.max(0, Math.round((expires.getTime() - Date.now()) / 3600000));
                                                                const isPending = ssState.activeBoost.status === 'pending';
                                                                return (
                                                                    <div className={styles.boostBadge}>
                                                                        {isPending ? <IoTime size={13} /> : <IoCheckmarkCircle size={13} />}
                                                                        <span>
                                                                            +{Math.round((ssState.activeBoost.boostMultiplier - 1) * 100)}% boost
                                                                            {isPending ? ' verifying...' : ` (${hoursLeft}h left)`}
                                                                        </span>
                                                                    </div>
                                                                );
                                                            })()}

                                                            <div className={styles.actions}>
                                                                <Button
                                                                    size="sm"
                                                                    variant="secondary"
                                                                    isLoading={isClaimLoading}
                                                                    disabled={!position.canClaim || !position.owned || isAnyActionLoading}
                                                                    onClick={() => { void runNftStakingAction(position.tokenId, 'claim'); }}
                                                                >
                                                                    {tr('wallet_v2_staking_claim', 'Claim')}
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    isLoading={isUnstakeLoading}
                                                                    disabled={!position.canUnstake || isAnyActionLoading}
                                                                    onClick={() => { void runNftStakingAction(position.tokenId, 'unstake'); }}
                                                                >
                                                                    {tr('wallet_v2_staking_unstake', 'Unstake')}
                                                                </Button>
                                                                {webApp?.shareToStory && position.owned && (() => {
                                                                    const ss = storyShareStates[position.tokenId];
                                                                    const isPending = ss?.activeBoost?.status === 'pending';
                                                                    const isVerified = ss?.activeBoost?.status === 'verified';
                                                                    if (isPending) {
                                                                        return (
                                                                            <Button size="sm" variant="secondary" disabled>
                                                                                <IoTime size={14} style={{ marginRight: 4 }} />
                                                                                Verifying...
                                                                            </Button>
                                                                        );
                                                                    }
                                                                    if (isVerified) return null;
                                                                    return (
                                                                        <Button
                                                                            size="sm"
                                                                            variant="primary"
                                                                            isLoading={storyShareLoadingTokenId === position.tokenId}
                                                                            disabled={isAnyActionLoading || storyShareLoadingTokenId !== null}
                                                                            onClick={() => { openStoryDrawer(position.tokenId); }}
                                                                        >
                                                                            <IoShareSocial size={14} style={{ marginRight: 4 }} />
                                                                            {tr('wallet_v2_story_share', 'Share Story +40%')}
                                                                        </Button>
                                                                    );
                                                                })()}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Available to stake */}
                                    {stakingAvailable.length > 0 && (
                                        <div className={styles.block}>
                                            <h4 className={styles.blockTitle}>
                                                {tr('wallet_v2_staking_available', 'Available to stake')}
                                            </h4>
                                            <div className={styles.list}>
                                                {stakingAvailable.map((item) => {
                                                    const isStakeLoading = nftStakingActionTokenId === item.tokenId && nftStakingActionType === 'stake';
                                                    const stakeDisabled = !item.stakeWindow.canStake || Boolean(nftStakingActionTokenId);
                                                    const stakeWindowMessage = item.stakeWindow.reason === 'not_open'
                                                        ? `${tr('wallet_v2_stake_opens', 'Opens')}: ${formatDateTime(item.stakeWindow.opensAt, locale)}`
                                                        : item.stakeWindow.reason === 'closed'
                                                            ? `${tr('wallet_v2_stake_closed', 'Closed')}: ${formatDateTime(item.stakeWindow.closesAt, locale)}`
                                                            : `${tr('wallet_v2_stake_open_until', 'Open until')}: ${formatDateTime(item.stakeWindow.closesAt, locale)}`;
                                                    const rarityLower = (item.rarity || '').toLowerCase();
                                                    const rarityBadgeClass = getRarityBadgeClass(item.rarity, styles);
                                                    const iconWrapClass = rarityLower === 'legendary'
                                                        ? styles.itemIconWrap
                                                        : `${styles.itemIconWrap} ${styles.itemIconWrapAvailable}`;

                                                    return (
                                                        <div key={item.tokenId} className={styles.item}>
                                                            <div className={styles.itemHead}>
                                                                <div className={iconWrapClass}>
                                                                    {getRarityIcon(item.rarity, 18)}
                                                                </div>
                                                                <div className={styles.itemTextWrap}>
                                                                    <p className={styles.itemTitle}>
                                                                        {item.collectionName}
                                                                        {item.serialNumber ? ` #${item.serialNumber}` : ''}
                                                                    </p>
                                                                    {rarityBadgeClass && item.rarity && (
                                                                        <span className={rarityBadgeClass}>
                                                                            {item.rarity}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className={styles.rewardStrip}>
                                                                <p className={styles.rewardStripRate}>
                                                                    {stakeWindowMessage}
                                                                </p>
                                                                <p className={styles.rewardStripPending}>
                                                                    +{formatIntegerString(item.rewardPerHour)} {stakingRewardAsset}/h
                                                                </p>
                                                            </div>
                                                            <div className={styles.actions}>
                                                                <Button
                                                                    size="sm"
                                                                    variant="primary"
                                                                    isLoading={isStakeLoading}
                                                                    disabled={stakeDisabled}
                                                                    onClick={() => { void runNftStakingAction(item.tokenId, 'stake'); }}
                                                                >
                                                                    {tr('wallet_v2_staking_stake', 'Stake')}
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Empty state */}
                                    {stakingPositions.length === 0 && stakingAvailable.length === 0 && (
                                        <div className={styles.emptyState}>
                                            <IoLayers size={40} className={styles.emptyIcon} />
                                            <p className={styles.emptyText}>
                                                {tr('wallet_v2_staking_empty', 'No NFTs are currently eligible for staking in this wallet.')}
                                            </p>
                                        </div>
                                    )}

                                </div>
                            )}
                        </>
                    )}

                </main>
            </div>

            {/* ── Story Share Drawer ────────────────────────────────────────── */}
            <BottomDrawer
                open={storyDrawerOpen}
                onClose={closeStoryDrawer}
                title={storyDrawerStep === 'verifying' ? 'Verifying Story' : 'Share Story'}
            >
                <div className={styles.drawerContent}>
                    {storyDrawerStep === 'rules' && (() => {
                        const ssState = storyDrawerTokenId ? storyShareStates[storyDrawerTokenId] : null;
                        const canShare = ssState?.canShare !== false;
                        const nextShareAt = ssState?.nextShareAt;
                        return (
                            <>
                                <div className={styles.drawerRules}>
                                    <div className={styles.drawerRule}>
                                        <IoSparkles size={16} className={styles.drawerRuleIcon} />
                                        <span>Get +40% staking reward boost for 3 days</span>
                                    </div>
                                    <div className={styles.drawerRule}>
                                        <IoShareSocial size={16} className={styles.drawerRuleIcon} />
                                        <span>Post a story to your Telegram profile</span>
                                    </div>
                                    <div className={styles.drawerRule}>
                                        <IoCheckmarkCircle size={16} className={styles.drawerRuleIcon} />
                                        <span>Our system will verify your story automatically</span>
                                    </div>
                                    <div className={styles.drawerRule}>
                                        <IoTime size={16} className={styles.drawerRuleIcon} />
                                        <span>Keep the story for at least 5 minutes</span>
                                    </div>
                                </div>
                                {!canShare && nextShareAt && (
                                    <p className={styles.drawerCooldown}>
                                        <IoTime size={14} />
                                        <span>Next share available: {formatDateTime(nextShareAt, locale)}</span>
                                    </p>
                                )}
                                {canShare && (
                                    <>
                                        <label className={styles.drawerCheckbox}>
                                            <input
                                                type="checkbox"
                                                checked={storyDrawerAgreed}
                                                onChange={(e) => setStoryDrawerAgreed(e.target.checked)}
                                            />
                                            <span>I agree to share a story with boost verification</span>
                                        </label>
                                        <Button
                                            variant="primary"
                                            disabled={!storyDrawerAgreed || storyShareLoadingTokenId !== null}
                                            isLoading={storyShareLoadingTokenId !== null}
                                            onClick={() => void handleShareStory()}
                                        >
                                            <IoShareSocial size={16} style={{ marginRight: 6 }} />
                                            Share Story Now
                                        </Button>
                                    </>
                                )}
                                {!canShare && (
                                    <Button variant="secondary" onClick={closeStoryDrawer}>
                                        Close
                                    </Button>
                                )}
                            </>
                        );
                    })()}

                    {storyDrawerStep === 'sharing' && (
                        <div className={styles.drawerVerifying}>
                            <div className={styles.drawerSpinner} />
                            <p>Preparing story card...</p>
                        </div>
                    )}

                    {storyDrawerStep === 'verifying' && (
                        <div className={styles.drawerVerifying}>
                            <IoTime size={32} className={styles.drawerVerifyIcon} />
                            <p className={styles.drawerVerifyTitle}>Story verification in progress</p>
                            <p className={styles.drawerVerifyHint}>
                                Our system will check your story shortly. Keep it posted for at least 5 minutes.
                            </p>
                            {storyDrawerCode && (
                                <div className={styles.drawerCodeBox}>
                                    <span>Verification code</span>
                                    <strong>{storyDrawerCode}</strong>
                                </div>
                            )}
                            <Button variant="secondary" onClick={closeStoryDrawer}>
                                Close
                            </Button>
                        </div>
                    )}
                </div>
            </BottomDrawer>
        </>
    );
}
