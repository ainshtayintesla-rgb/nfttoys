'use client';

import React from 'react';

import { SkeletonCircle, SkeletonLine } from './Skeleton';
import styles from './WalletPageSkeleton.module.css';

type WalletSkeletonVariant = 'full' | 'feed' | 'nft';

interface WalletPageSkeletonProps {
    variant?: WalletSkeletonVariant;
    groupCount?: number;
    cardsPerGroup?: number;
}

function createRange(size: number): number[] {
    return Array.from({ length: size }, (_, index) => index);
}

function HistorySkeleton({
    variant,
    groupCount,
    cardsPerGroup,
}: {
    variant: Exclude<WalletSkeletonVariant, 'full'>;
    groupCount: number;
    cardsPerGroup: number;
}) {
    return (
        <section className={styles.historySection}>
            {createRange(groupCount).map((groupIndex) => (
                <div key={groupIndex} className={styles.group}>
                    <SkeletonLine className={styles.groupTitle} height={14} />
                    <div className={styles.cards}>
                        {createRange(cardsPerGroup).map((cardIndex) => (
                            <article key={`${groupIndex}-${cardIndex}`} className={styles.txCard}>
                                <div className={styles.txRow}>
                                    <div className={styles.txLeft}>
                                        <SkeletonCircle size={44} />
                                        <div className={styles.txText}>
                                            <SkeletonLine className={styles.txDirection} height={14} />
                                            <SkeletonLine className={styles.txAmount} height={12} />
                                        </div>
                                    </div>
                                    <div className={styles.txRight}>
                                        <SkeletonLine
                                            className={variant === 'nft' ? styles.nftAsset : styles.txStatus}
                                            height={12}
                                        />
                                        <SkeletonLine className={styles.txDate} height={11} />
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                </div>
            ))}
        </section>
    );
}

export function WalletPageSkeleton({
    variant = 'full',
    groupCount = 2,
    cardsPerGroup = 3,
}: WalletPageSkeletonProps) {
    if (variant === 'feed' || variant === 'nft') {
        return <HistorySkeleton variant={variant} groupCount={groupCount} cardsPerGroup={cardsPerGroup} />;
    }

    return (
        <div className={styles.skeletonRoot} aria-hidden="true">
            <section className={`${styles.card} ${styles.balanceCard}`}>
                <div className={styles.badge}>
                    <SkeletonCircle size={16} />
                    <SkeletonLine className={styles.badgeText} height={12} />
                </div>

                <div className={styles.amountRow}>
                    <SkeletonLine className={styles.amountValue} height={44} />
                    <SkeletonLine className={styles.amountCurrency} height={14} />
                </div>

                <div className={styles.actionRow}>
                    {createRange(4).map((index) => (
                        <div key={index} className={styles.actionTile}>
                            <SkeletonCircle size={50} />
                            <SkeletonLine className={styles.actionLabel} height={12} />
                        </div>
                    ))}
                </div>
            </section>

            <section className={styles.tabs}>
                <div className={`${styles.tab} ${styles.tabActive}`}>
                    <SkeletonLine className={styles.tabLabel} height={14} />
                </div>
                <div className={styles.tab}>
                    <SkeletonLine className={styles.tabLabel} height={14} />
                </div>
            </section>

            <HistorySkeleton variant="feed" groupCount={groupCount} cardsPerGroup={cardsPerGroup} />
        </div>
    );
}
