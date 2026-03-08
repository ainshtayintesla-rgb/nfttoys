'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Navigation } from '@/components/layout/Navigation';
import { TransferModal } from '@/components/features/TransferModal';
import { Button } from '@/components/ui/Button';
import { TgsPlayer } from '@/components/ui/TgsPlayer';
import { ActionLinkList } from '@/components/ui/ActionLinkList';
import { useLanguage } from '@/lib/context/LanguageContext';
import { useTelegram } from '@/lib/context/TelegramContext';
import { api } from '@/lib/api';
import { IoLockClosed, IoPerson, IoWallet, IoQrCode, IoAdd, IoCheckmarkCircle, IoTime, IoSettings, IoChatbubbles, IoMegaphone, IoGift } from 'react-icons/io5';
import styles from './page.module.css';

interface NFTItem {
    tokenId: string;
    modelName: string;
    collectionName?: string | null;
    collectionActiveCount?: number | null;
    collectionMintedCount?: number | null;
    serialNumber: string | number;
    rarity: string;
    tgsFile: string;
    tgsUrl: string;
}

const ADMIN_IDS = process.env.NEXT_PUBLIC_ADMIN_IDS?.split(',') || [];

export default function ProfilePage() {
    const { t } = useLanguage();
    const { user, authUser, authReady, haptic, webApp } = useTelegram();
    const router = useRouter();
    const [selectedNFT, setSelectedNFT] = useState<NFTItem | null>(null);
    const [stats, setStats] = useState({ total: 0, used: 0, created: 0 });
    const [myNFTs, setMyNFTs] = useState<NFTItem[]>([]);
    const [isLoadingNFTs, setIsLoadingNFTs] = useState(true);
    const nftAnimationStyle = useMemo(() => ({ width: 62.4, height: 62.4 }), []);
    const isNFTRequestInFlight = useRef(false);

    const telegramUserId = user?.id || webApp?.initDataUnsafe?.user?.id;
    const isAdmin = Boolean(telegramUserId && ADMIN_IDS.includes(String(telegramUserId)));

    useEffect(() => {
        const backButton = webApp?.BackButton;
        if (!backButton) {
            return;
        }

        backButton.hide();
    }, [webApp]);

    // Load QR stats for admins only
    useEffect(() => {
        if (!isAdmin) {
            setStats({ total: 0, used: 0, created: 0 });
            return;
        }

        const loadStats = async () => {
            try {
                const data = await api.qr.list();
                if (data.stats) {
                    setStats(data.stats);
                }
            } catch (error) {
                console.error('Error loading stats:', error);
            }
        };

        loadStats();
    }, [isAdmin]);

    const loadNFTs = useCallback(async (silent = false) => {
        if (!authReady || !authUser?.uid || isNFTRequestInFlight.current) {
            return;
        }

        isNFTRequestInFlight.current = true;

        if (!silent) {
            setIsLoadingNFTs(true);
        }

        try {
            const data = await api.nft.my({ userId: authUser.uid });
            if (data.success) {
                setMyNFTs(data.nfts || []);
            }
        } catch (error) {
            console.error('Error loading NFTs:', error);
        } finally {
            if (!silent) {
                setIsLoadingNFTs(false);
            }
            isNFTRequestInFlight.current = false;
        }
    }, [authReady, authUser?.uid]);

    // Initial load user's NFTs
    useEffect(() => {
        if (!authReady || !authUser?.uid) {
            return;
        }

        void loadNFTs(false);
    }, [authReady, authUser?.uid, loadNFTs]);

    // Live sync for profile page (recipient gets NFTs without manual reload)
    useEffect(() => {
        if (!authUser?.uid) {
            return;
        }

        const refreshIfVisible = () => {
            if (!document.hidden) {
                void loadNFTs(true);
            }
        };

        const intervalId = window.setInterval(refreshIfVisible, 3000);

        window.addEventListener('focus', refreshIfVisible);
        document.addEventListener('visibilitychange', refreshIfVisible);

        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener('focus', refreshIfVisible);
            document.removeEventListener('visibilitychange', refreshIfVisible);
        };
    }, [authUser?.uid, loadNFTs]);

    const handleTransfer = (nft: NFTItem) => {
        setSelectedNFT(nft);
    };

    if (!user) {
        return (
            <div className={styles.container}>
                <main className={styles.main}>
                    <div className={styles.loginCard}>
                        <div className={styles.loginIcon}>
                            <IoLockClosed size={32} />
                        </div>
                        <h2 className={styles.loginTitle}>{t('login_required')}</h2>
                        <p className={styles.loginDesc}>{t('login_desc')}</p>
                        <Button
                            variant="primary"
                            fullWidth
                            onClick={() => window.open('https://t.me/PlatformAntigravityBot', '_blank')}
                        >
                            {t('login_btn')}
                        </Button>
                    </div>

                    {isAdmin && (
                        <div className={styles.adminBtn}>
                            <Button
                                variant="secondary"
                                fullWidth
                                onClick={() => window.location.href = '/admin'}
                            >
                                <IoQrCode size={18} />
                                Admin Panel
                            </Button>
                        </div>
                    )}
                </main>
                <Navigation />
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Top right actions */}
            <div className={styles.topActions}>
                <button
                    className={styles.settingsBtn}
                    onClick={() => {
                        haptic.impact('light');
                        router.push('/transactions');
                    }}
                >
                    <IoTime size={22} />
                </button>
                <button
                    className={styles.settingsBtn}
                    onClick={() => {
                        haptic.impact('light');
                        router.push('/settings');
                    }}
                >
                    <IoSettings size={22} />
                </button>
            </div>

            <main className={styles.main}>
                {/* Profile Header - centered */}
                <div className={styles.profileHeader}>
                    <div className={styles.avatar}>
                        {user.photo_url ? (
                            <img
                                src={user.photo_url}
                                alt={user.first_name}
                                className={styles.avatarImage}
                            />
                        ) : (
                            user.first_name?.[0] || <IoPerson size={32} />
                        )}
                    </div>
                    <span className={styles.username}>
                        {user.username ? `@${user.username}` : `${user.first_name} ${user.last_name || ''}`}
                    </span>
                </div>

                <ActionLinkList
                    joined
                    items={[
                        {
                            key: 'wallet',
                            icon: <IoWallet size={22} color="white" />,
                            label: t('wallet') || 'Wallet',
                            iconBackground: 'linear-gradient(135deg, #22c55e, #16a34a)',
                            onClick: () => {
                                haptic.impact('light');
                                router.push('/wallet');
                            },
                        },
                        {
                            key: 'wallet-v2',
                            icon: <IoWallet size={22} color="white" />,
                            label: t('wallet_v2') || 'Wallet v2',
                            iconBackground: 'linear-gradient(135deg, #06b6d4, #0284c7)',
                            onClick: () => {
                                haptic.impact('light');
                                router.push('/wallet-v2');
                            },
                        },
                        {
                            key: 'referrals',
                            icon: <IoGift size={22} color="white" />,
                            label: t('referrals') || 'Referrals',
                            iconBackground: 'linear-gradient(135deg, #14b8a6, #22c55e)',
                            onClick: () => {
                                haptic.impact('light');
                                router.push('/referrals');
                            },
                        },
                    ]}
                />

                <ActionLinkList
                    joined
                    items={[
                        {
                            key: 'community-chat',
                            icon: <IoChatbubbles size={22} color="white" />,
                            label: t('community_chat') || 'Community Chat',
                            iconBackground: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                            onClick: () => {
                                haptic.impact('light');
                                const url = `https://t.me/${process.env.NEXT_PUBLIC_TG_GROUP || 'nfttoys_chat'}`;
                                if (webApp?.openTelegramLink) {
                                    webApp.openTelegramLink(url);
                                    return;
                                }
                                window.open(url, '_blank');
                            },
                        },
                        {
                            key: 'channel-news',
                            icon: <IoMegaphone size={22} color="white" />,
                            label: t('channel_news') || 'Channel News',
                            iconBackground: 'linear-gradient(135deg, #f59e0b, #ef4444)',
                            onClick: () => {
                                haptic.impact('light');
                                const url = `https://t.me/${process.env.NEXT_PUBLIC_TG_CHANNEL || 'nfttoys'}`;
                                if (webApp?.openTelegramLink) {
                                    webApp.openTelegramLink(url);
                                    return;
                                }
                                window.open(url, '_blank');
                            },
                        },
                    ]}
                />

                {isAdmin && (
                    <section className={styles.adminSection}>

                        <div className={styles.statsGrid}>
                            <div className={styles.statCard}>
                                <div className={styles.statIcon} style={{ background: 'rgba(59, 130, 246, 0.2)' }}>
                                    <IoQrCode size={20} color="#3b82f6" />
                                </div>
                                <div className={styles.statInfo}>
                                    <span className={styles.statValue}>{stats.total}</span>
                                    <span className={styles.statLabel}>{t('total_qr')}</span>
                                </div>
                            </div>
                            <div className={styles.statCard}>
                                <div className={styles.statIcon} style={{ background: 'rgba(251, 191, 36, 0.2)' }}>
                                    <IoTime size={20} color="#fbbf24" />
                                </div>
                                <div className={styles.statInfo}>
                                    <span className={styles.statValue}>{stats.created}</span>
                                    <span className={styles.statLabel}>{t('waiting')}</span>
                                </div>
                            </div>
                            <div className={styles.statCard}>
                                <div className={styles.statIcon} style={{ background: 'rgba(34, 197, 94, 0.2)' }}>
                                    <IoCheckmarkCircle size={20} color="#22c55e" />
                                </div>
                                <div className={styles.statInfo}>
                                    <span className={styles.statValue}>{stats.used}</span>
                                    <span className={styles.statLabel}>{t('used')}</span>
                                </div>
                            </div>
                        </div>

                        <Button
                            variant="primary"
                            fullWidth
                            onClick={() => window.location.href = '/admin'}
                            className={styles.createBtn}
                        >
                            <IoAdd size={18} />
                            {t('create_new_qr')}
                        </Button>
                    </section>
                )}

                <section className={styles.collection}>
                    <h3 className={styles.sectionTitle}>{t('my_collection')}</h3>
                    {isLoadingNFTs ? (
                        <div className={`${styles.grid} ${styles.grid3}`}>
                            {[1, 2, 3].map(i => (
                                <div key={i} className={`${styles.nftCard} ${styles.skeleton}`}></div>
                            ))}
                        </div>
                    ) : myNFTs.length > 0 ? (
                        <div className={`${styles.grid} ${myNFTs.length === 1 ? styles.grid1 : myNFTs.length === 2 ? styles.grid2 : styles.grid3}`}>
                            {myNFTs.map(nft => (
                                <div
                                    key={nft.tokenId}
                                    className={styles.nftCard}
                                    onClick={() => handleTransfer(nft)}
                                >
                                    <div className={styles.ribbon} data-serial={`#${nft.serialNumber}`}></div>
                                    <div className={styles.nftImage}>
                                        <TgsPlayer
                                            src={nft.tgsUrl}
                                            cacheKey={`profile:${nft.tgsFile || nft.tokenId}`}
                                            style={nftAnimationStyle}
                                            autoplay
                                            renderer="canvas"
                                            unstyled
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className={styles.empty}>
                            <p>{t('no_nft')}</p>
                            <p className={styles.emptyHint}>{t('scan_to_activate')}</p>
                        </div>
                    )}
                </section>
            </main>

            <Navigation />

            {selectedNFT && (
                <TransferModal
                    isOpen={!!selectedNFT}
                    onClose={() => setSelectedNFT(null)}
                    nft={selectedNFT}
                    onSuccess={async () => {
                        await loadNFTs(true);
                    }}
                />
            )}
        </div>
    );
}
