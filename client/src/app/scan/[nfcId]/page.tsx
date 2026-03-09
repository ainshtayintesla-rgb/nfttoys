'use client';

import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { useParams, useRouter } from 'next/navigation';

import { Navigation } from '@/components/layout/Navigation';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/lib/context/LanguageContext';
import { useTelegram } from '@/lib/context/TelegramContext';

import { TgsPlayer } from '@/components/ui/TgsPlayer';
import { api } from '@/lib/api';
import styles from './page.module.css';

interface ActivatedToy {
    id: string;
    name: string;
    serialNumber: number;
    rarity: string;
    tgsFile: string;
    tgsUrl: string;
}

interface NFTData {
    tokenId: string;
    contractAddress: string;
    ownerWallet: string;
    txHash: string;
}

export default function ScanResultPage() {
    const params = useParams();
    const router = useRouter();
    const { t } = useLanguage();
    const { authReady } = useTelegram();
    const [toy, setToy] = useState<ActivatedToy | null>(null);
    const [nft, setNft] = useState<NFTData | null>(null);
    const [status, setStatus] = useState<'loading' | 'activating' | 'success' | 'already_used' | 'not_found' | 'error'>('loading');
    const [activationTime, setActivationTime] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string>('');

    // Activate QR on mount
    useEffect(() => {
        const activateQR = async () => {
            if (!authReady) {
                return;
            }

            // The URL parameter is actually the token (contains HMAC signature)
            // Decode it in case it's URL-encoded
            const rawToken = params.nfcId as string;
            const token = rawToken ? decodeURIComponent(rawToken) : '';

            if (!token) {
                setStatus('not_found');
                return;
            }

            try {
                setStatus('activating');
                const data = await api.qr.activate({
                    token,
                });

                if (data.success) {
                    setToy(data.toy);
                    setNft(data.nft);
                    setActivationTime(data.activatedAt);
                    setStatus('success');
                } else if (data.code === 'ALREADY_USED') {
                    setStatus('already_used');
                    setErrorMessage('This QR code has already been activated.');
                } else if (data.code === 'NOT_FOUND') {
                    setStatus('not_found');
                } else {
                    setStatus('error');
                    setErrorMessage(data.error || 'Activation failed');
                }
            } catch (error: unknown) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                console.error('Activation error:', error);
                if (errorMsg?.includes('ALREADY_USED')) {
                    setStatus('already_used');
                    setErrorMessage('This QR code has already been activated.');
                } else {
                    setStatus('error');
                    setErrorMessage('Network error. Please try again.');
                }
            }
        };

        void activateQR();
    }, [authReady, params.nfcId]);

    // Confetti celebration effect
    useEffect(() => {
        if (status === 'success') {
            // Left popper
            confetti({
                particleCount: 100,
                spread: 70,
                origin: { x: 0.1, y: 0.9 },
                angle: 60,
                colors: ['#4ade80', '#22d3ee', '#a78bfa', '#f472b6', '#fbbf24']
            });
            // Right popper
            confetti({
                particleCount: 100,
                spread: 70,
                origin: { x: 0.9, y: 0.9 },
                angle: 120,
                colors: ['#4ade80', '#22d3ee', '#a78bfa', '#f472b6', '#fbbf24']
            });
        }
    }, [status]);

    const renderContent = () => {
        if (status === 'loading' || status === 'activating') {
            return <div className={styles.loading}>{t('scanning')}</div>;
        }

        if (status === 'not_found') {
            return (
                <div className={styles.error}>
                    <h3>{t('not_found')}</h3>
                    <Button onClick={() => router.push('/scan')} variant="secondary">Back</Button>
                </div>
            );
        }

        if (status === 'error' || status === 'already_used') {
            return (
                <div className={styles.error}>
                    <h3>{status === 'already_used' ? 'Already Activated' : 'Error'}</h3>
                    <p>{errorMessage}</p>
                    <Button onClick={() => router.push('/scan')} variant="secondary">Scan Again</Button>
                </div>
            );
        }

        if (status === 'success' && toy) {
            return (
                <div className={styles.successContainer}>
                    <div className={styles.successIcon}>
                        <TgsPlayer
                            src={toy.tgsUrl}
                            style={{ width: 120, height: 120 }}
                            loop={true}
                        />
                    </div>
                    <h3 className={styles.successTitle}>{t('activation_success') || 'Success!'}</h3>
                    <p className={styles.successDesc}>
                        {toy.name} #{toy.serialNumber} is now yours!
                    </p>

                    {nft && (
                        <div className={styles.nftInfo}>
                            <span className={styles.tokenId}>Token: {nft.tokenId.slice(0, 20)}...</span>
                        </div>
                    )}

                    <div className={styles.timeBadge}>
                        <span>{t('time') || 'Time'}: {new Date(activationTime || '').toLocaleString('ru-RU')}</span>
                    </div>

                    <Button onClick={() => router.push('/profile')} variant="primary" fullWidth className={styles.mt4}>
                        View My Collection
                    </Button>
                </div>
            );
        }

        return null;
    };

    return (
        <div className={styles.container}>
            <main className={styles.main}>
                {renderContent()}
            </main>
            <Navigation />
        </div>
    );
}
