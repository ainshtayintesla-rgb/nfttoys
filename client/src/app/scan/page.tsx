'use client';

import React from 'react';
import { useRouter } from 'next/navigation';

import { Navigation } from '@/components/layout/Navigation';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/lib/context/LanguageContext';
import { useTelegram } from '@/lib/context/TelegramContext';
import { Scan, Camera } from 'lucide-react';
import { QRScanner } from '@/components/features/QRScanner';
import styles from './page.module.css';

const normalizeToken = (rawToken: string): string => {
    const trimmed = rawToken.trim().replace(/^activate_/i, '');
    if (!trimmed) return '';

    try {
        return decodeURIComponent(trimmed);
    } catch {
        return trimmed;
    }
};

const toActivationPath = (rawToken: string): string | null => {
    const token = normalizeToken(rawToken);
    if (!token) return null;
    return `/activate/${encodeURIComponent(token)}`;
};

const extractTokenFromUrl = (url: URL): string | null => {
    const startParam = url.searchParams.get('startapp') || url.searchParams.get('start');
    if (startParam) {
        const parsed = normalizeToken(startParam);
        if (parsed) return parsed;
    }

    const activatePathMatch = url.pathname.match(/\/activate\/([^/?#]+)/i);
    if (activatePathMatch?.[1]) {
        return normalizeToken(activatePathMatch[1]);
    }

    return null;
};

const resolveActivationPath = (rawInput: string): string | null => {
    const input = rawInput.trim();
    if (!input) return null;

    const activatePathMatch = input.match(/\/activate\/([^/?#]+)/i);
    if (activatePathMatch?.[1]) {
        return toActivationPath(activatePathMatch[1]);
    }

    const deepLinkMatch = input.match(/[?&](?:startapp|start)=([^&]+)/i);
    if (deepLinkMatch?.[1]) {
        return toActivationPath(deepLinkMatch[1]);
    }

    if (input.startsWith('/')) {
        return input;
    }

    if (input.startsWith('activate_')) {
        return toActivationPath(input);
    }

    try {
        const url = new URL(input);
        const tokenFromUrl = extractTokenFromUrl(url);

        if (tokenFromUrl) {
            return toActivationPath(tokenFromUrl);
        }

        if (url.pathname.startsWith('/')) {
            return url.pathname;
        }
    } catch {
        // Not a URL, continue with token fallback.
    }

    const lastPathPart = input.split('/').filter(Boolean).pop();
    if (lastPathPart) {
        return toActivationPath(lastPathPart);
    }

    return toActivationPath(input);
};

export default function ScanPage() {
    const router = useRouter();
    const { t } = useLanguage();
    const { webApp } = useTelegram();

    const [isScanning, setIsScanning] = React.useState(false);
    const [isLoading, setIsLoading] = React.useState(false);
    const [useTelegramScanner, setUseTelegramScanner] = React.useState(false);
    const [scanError, setScanError] = React.useState<string | null>(null);

    const hasStartedRef = React.useRef(false);

    const hasTelegramScanner = React.useMemo(() => {
        if (!webApp) return false;
        const version = parseFloat(webApp.version || '0');
        return version >= 6.4 && typeof webApp.showScanQrPopup === 'function';
    }, [webApp]);

    const handleScan = React.useCallback((rawText: string) => {
        if (!rawText || isLoading) {
            return;
        }

        const redirectUrl = resolveActivationPath(rawText);
        if (!redirectUrl) {
            setScanError('Invalid activation data. Try another QR code.');
            return;
        }

        setIsLoading(true);
        setIsScanning(false);

        if (useTelegramScanner) {
            try {
                webApp?.closeScanQrPopup?.();
            } catch {
                // noop
            }
        }

        setTimeout(() => {
            router.push(redirectUrl);
        }, 300);
    }, [isLoading, router, useTelegramScanner, webApp]);

    const startTelegramScanner = React.useCallback(() => {
        if (!webApp || !hasTelegramScanner) return;

        if (hasStartedRef.current) return;
        hasStartedRef.current = true;

        setScanError(null);
        setIsScanning(true);

        try {
            webApp.showScanQrPopup(
                { text: t('scan_hint') || 'Point camera at QR code' },
                (text: string) => {
                    if (text) {
                        handleScan(text);
                        return true;
                    }
                    return false;
                }
            );
        } catch (error) {
            console.error('Telegram scanner error:', error);
            setScanError('Could not start Telegram scanner. Please try again.');
            setIsScanning(false);
            hasStartedRef.current = false;
        }
    }, [webApp, hasTelegramScanner, t, handleScan]);

    const startCustomScanner = React.useCallback(() => {
        setScanError(null);
        setUseTelegramScanner(false);
        setIsScanning(true);
        hasStartedRef.current = true;
    }, []);

    React.useEffect(() => {
        if (hasStartedRef.current) {
            return;
        }

        if (hasTelegramScanner) {
            setUseTelegramScanner(true);
            startTelegramScanner();
        } else {
            setUseTelegramScanner(false);
            setIsScanning(true);
            hasStartedRef.current = true;
        }
    }, [hasTelegramScanner, startTelegramScanner]);

    React.useEffect(() => {
        return () => {
            try {
                webApp?.closeScanQrPopup?.();
            } catch {
                // noop
            }
        };
    }, [webApp]);

    return (
        <div className={styles.container}>
            <main className={styles.main}>
                <div className={styles.scanZone}>
                    <div className={styles.cameraFrame}>
                        {isScanning && !useTelegramScanner && (
                            <div className={styles.scannerContainer}>
                                <QRScanner
                                    onScan={handleScan}
                                    onError={(error) => {
                                        console.error('QR Scanner error:', error);
                                        setScanError('Camera error. Try Telegram scanner instead.');
                                    }}
                                />
                            </div>
                        )}

                        {useTelegramScanner && isScanning && (
                            <div className={styles.telegramScannerHint}>
                                <Camera size={48} className={styles.scanIcon} />
                                <p>{t('scanning') || 'Scanning...'}</p>
                            </div>
                        )}

                        <div className={styles.cornerTL}></div>
                        <div className={styles.cornerTR}></div>
                        <div className={styles.cornerBL}></div>
                        <div className={styles.cornerBR}></div>

                        {isScanning && !useTelegramScanner && <div className={styles.scanLine}></div>}

                        {!isScanning && (
                            <div className={styles.iconOverlay}>
                                <Scan size={48} className={styles.scanIcon} strokeWidth={1} />
                            </div>
                        )}
                    </div>

                    {scanError && (
                        <div className={styles.errorContainer}>
                            <p className={styles.errorText}>{scanError}</p>
                            <div className={styles.buttonRow}>
                                {hasTelegramScanner && (
                                    <Button onClick={startTelegramScanner} variant="primary">
                                        Use Telegram Scanner
                                    </Button>
                                )}
                                <Button onClick={startCustomScanner} variant="secondary">
                                    Use Camera
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            <Navigation />
        </div>
    );
}
