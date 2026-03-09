'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { IoShareSocial, IoPeople, IoPerson } from 'react-icons/io5';

import { api } from '@/lib/api';
import { useLanguage } from '@/lib/context/LanguageContext';
import { useTelegram } from '@/lib/context/TelegramContext';

import styles from './page.module.css';

interface ReferralJoinedUser {
    id: string;
    username: string | null;
    firstName: string | null;
    photoUrl: string | null;
    joinedAt: string;
}

interface ReferralOverview {
    referralCode: string;
    botUsername: string | null;
    total: number;
    joined: ReferralJoinedUser[];
}

function getLocaleForDateFormat(locale: string): string {
    if (locale === 'ru') return 'ru-RU';
    if (locale === 'uz') return 'uz-UZ';
    return 'en-US';
}

export default function ReferralsPage() {
    const router = useRouter();
    const { t, locale } = useLanguage();
    const { webApp, haptic, authReady, isAuthenticated, authUser } = useTelegram();

    const [overview, setOverview] = useState<ReferralOverview | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSharing, setIsSharing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleBack = useCallback(() => {
        haptic.impact('light');
        if (window.history.length > 1) {
            router.back();
            return;
        }
        router.push('/profile');
    }, [haptic, router]);

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
    }, [webApp, handleBack]);

    useEffect(() => {
        if (!authReady) {
            return;
        }

        if (!isAuthenticated || !authUser) {
            setIsLoading(false);
            setOverview(null);
            return;
        }

        let isUnmounted = false;

        const loadOverview = async () => {
            setIsLoading(true);
            setError(null);

            try {
                const response = await api.referrals.getOverview();
                if (!isUnmounted) {
                    setOverview(response.referral || null);
                }
            } catch (loadError) {
                if (!isUnmounted) {
                    setError(loadError instanceof Error ? loadError.message : 'Failed to load referrals');
                }
            } finally {
                if (!isUnmounted) {
                    setIsLoading(false);
                }
            }
        };

        void loadOverview();

        return () => {
            isUnmounted = true;
        };
    }, [authReady, authUser, isAuthenticated]);

    const referralLink = useMemo(() => {
        const referralCode = overview?.referralCode?.trim();
        const botUsername = (overview?.botUsername || '').trim().replace(/^@+/, '');
        if (!referralCode || !botUsername) {
            return '';
        }

        return `https://t.me/${botUsername}?startapp=${encodeURIComponent(`ref_${referralCode}`)}`;
    }, [overview?.botUsername, overview?.referralCode]);

    const handleShare = async () => {
        if (!referralLink || isSharing) {
            return;
        }

        setIsSharing(true);
        haptic.impact('medium');

        const inviteText = t('referrals_invite_text') || 'Join me in NFT Toys Mini App:';
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(inviteText)}`;

        try {
            if (webApp?.openTelegramLink) {
                webApp.openTelegramLink(shareUrl);
            } else {
                window.open(shareUrl, '_blank', 'noopener,noreferrer');
            }
        } catch {
            window.open(shareUrl, '_blank', 'noopener,noreferrer');
        } finally {
            setIsSharing(false);
        }
    };

    const dateLocale = getLocaleForDateFormat(locale);

    return (
        <div className={styles.container}>
            <main className={styles.main}>
                <header className={styles.header}>
                    <h1>{t('referrals_title') || 'Referrals'}</h1>
                    <p>{t('referrals_subtitle') || 'Invite friends and track who joined the Mini App.'}</p>
                </header>

                <section className={styles.heroCard}>
                    <div className={styles.heroTop}>
                        <div className={styles.heroBadge}>
                            <IoPeople size={18} />
                            <span>{t('referrals_total') || 'Joined by your link'}</span>
                        </div>
                        <strong className={styles.totalValue}>{overview?.total ?? 0}</strong>
                    </div>

                    <button
                        type="button"
                        className={styles.shareButton}
                        onClick={handleShare}
                        disabled={!referralLink || isSharing || isLoading}
                    >
                        <IoShareSocial size={18} />
                        <span>{t('referrals_share') || 'Share referral link'}</span>
                    </button>
                </section>

                <section className={styles.listCard}>
                    <div className={styles.listHeader}>
                        <h2>{t('referrals_joined_title') || 'Who joined'}</h2>
                    </div>

                    {isLoading && (
                        <p className={styles.statusText}>{t('referrals_loading') || 'Loading referrals...'}</p>
                    )}

                    {!isLoading && error && (
                        <p className={styles.errorText}>{error || t('referrals_error') || 'Failed to load referrals.'}</p>
                    )}

                    {!isLoading && !error && (!overview || overview.joined.length === 0) && (
                        <p className={styles.statusText}>{t('referrals_empty') || 'No one has joined by your link yet.'}</p>
                    )}

                    {!isLoading && !error && overview && overview.joined.length > 0 && (
                        <div className={styles.joinedList}>
                            {overview.joined.map((user) => {
                                const displayName = user.username
                                    ? `@${user.username}`
                                    : (user.firstName || 'User');

                                const joinedDate = new Date(user.joinedAt);
                                const joinedLabel = Number.isNaN(joinedDate.getTime())
                                    ? '—'
                                    : joinedDate.toLocaleDateString(dateLocale, {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric',
                                    });

                                return (
                                    <div key={user.id} className={styles.joinedItem}>
                                        <div className={styles.joinedLeft}>
                                            <div className={styles.avatar}>
                                                {user.photoUrl ? (
                                                    <img src={user.photoUrl} alt={displayName} />
                                                ) : (
                                                    <IoPerson size={16} />
                                                )}
                                            </div>

                                            <div className={styles.userInfo}>
                                                <span className={styles.userName}>{displayName}</span>
                                                <span className={styles.joinedDate}>{joinedLabel}</span>
                                            </div>
                                        </div>

                                        <ChevronRight size={16} className={styles.itemArrow} />
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}
