'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

import { Navigation } from '@/components/layout/Navigation';
import { TransferModal } from '@/components/features/TransferModal';
import { useLanguage } from '@/lib/context/LanguageContext';
import { useTelegram } from '@/lib/context/TelegramContext';
import { mockToys, Toy } from '@/lib/mock/toys';
import { TgsPlayer } from '@/components/ui/TgsPlayer';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { IoImage, IoFlash, IoSend } from 'react-icons/io5';
import styles from './page.module.css';



export default function ToyDetailPage() {
    const params = useParams();
    const { t } = useLanguage();
    const { user } = useTelegram();
    const [toy, setToy] = useState<Toy | null>(null);
    const [transferModalOpen, setTransferModalOpen] = useState(false);


    useEffect(() => {
        const foundToy = mockToys.find(t => t.id === params.id);
        if (foundToy) {
            queueMicrotask(() => setToy(foundToy));
        }
    }, [params.id]);

    if (!toy) {
        return <div className={styles.container}><main className={styles.main}>{t('loading')}</main></div>;
    }

    const isOwner = user?.id === toy.ownerId;

    return (
        <div className={styles.container}>
            <main className={styles.main}>
                {/* Left Column: Image */}
                <div className={styles.imageWrapper}>
                    {toy.tgsUrl ? (
                        <TgsPlayer
                            src={toy.tgsUrl}
                            style={{ width: '100%', height: '100%' }}
                            className={styles.tgsPlayer}
                            loop={false}
                            playOnHover={true}
                            unstyled={true}
                        />
                    ) : (
                        <div className={styles.imagePlaceholder}>
                            <IoImage size={140} color="rgba(255,255,255,0.4)" />
                        </div>
                    )}
                </div>

                {/* Right Column: Info */}
                <div className={styles.infoColumn}>
                    {/* Collection Header */}
                    <div className={styles.headerBlock}>
                        <div className={styles.titleRow}>
                            <div className={styles.collectionRow}>
                                <span>{t('collection_name')}</span>
                                <VerifiedBadge size={20} />
                            </div>
                            <h1 className={styles.title}>{toy.name}</h1>
                        </div>
                    </div>

                    {/* Price Section */}
                    {/* Price Section */}
                    <div className={styles.priceBlock}>
                        {/* Left: Owner */}
                        <div className={styles.ownerInfo}>
                            <span className={styles.priceLabel}>{t('owner')}</span>
                            <div className={styles.ownerRow}>
                                <div className={styles.avatar}>
                                    <IoImage size={20} />
                                </div>
                                <span className={styles.ownerName}>User {toy.ownerId || 'System'}</span>
                            </div>
                        </div>

                        {/* Right: Price */}
                        <div className={styles.priceInfo}>
                            <span className={styles.priceLabel} style={{ textAlign: 'right' }}>{t('price')}</span>
                            <div className={styles.mainPrice}>{toy.price.toLocaleString('de-DE')} UZS</div>
                        </div>
                    </div>

                    {/* Action Button */}
                    <div className={styles.actionBlock}>
                        {isOwner ? (
                            <button className={styles.buyButton} onClick={() => setTransferModalOpen(true)}>
                                <IoSend size={20} />
                                {t('transfer')}
                            </button>
                        ) : (
                            <button className={styles.buyButton}>
                                <IoFlash size={20} />
                                {t('buy')}
                            </button>
                        )}
                    </div>

                    {/* Details Content */}
                    <div className={styles.detailsSection}>

                        <div className={styles.sectionTitle}>{t('rarity_attributes')}</div>
                        <div className={styles.attrsGrid}>
                            <div className={styles.attrCard}>
                                <span className={styles.attrLabel}>{t('rarity')}</span>
                                <span className={styles.attrValue}>{toy.rarityChance}%</span>
                            </div>
                            <div className={styles.attrCard}>
                                <span className={styles.attrLabel}>{t('number')}</span>
                                <span className={styles.attrValue}>
                                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                    {(toy as any).serialNumber ? `#${parseInt((toy as any).serialNumber.replace('#', ''), 10)}` : '---'}
                                </span>
                            </div>
                        </div>

                        <div className={styles.sectionTitle}>{t('description')}</div>
                        <div style={{ color: '#aaa', lineHeight: 1.6, fontSize: 15 }}>
                            {t('description_text')}
                        </div>
                    </div>
                </div>
            </main>

            <Navigation />

            {isOwner && (
                <TransferModal
                    isOpen={transferModalOpen}
                    onClose={() => setTransferModalOpen(false)}
                    nft={{
                        tokenId: toy.id,
                        modelName: toy.name,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        serialNumber: parseInt(((toy as any).serialNumber || '#0').replace('#', ''), 10),
                        rarity: toy.rarity,
                        tgsUrl: toy.tgsUrl || '',
                    }}
                />
            )}
        </div>
    );
}
