'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { Camera, CameraOff, RefreshCw, AlertTriangle } from 'lucide-react';
import styles from './QRScanner.module.css';

// Declare Telegram WebApp type for window object
declare global {
    interface Window {
        Telegram?: {
            WebApp?: {
                showAlert: (message: string) => void;
            };
        };
    }
}

interface QRScannerProps {
    onScan: (text: string) => void;
    onError?: (error: unknown) => void;
}

type CameraStatus = 'checking' | 'requesting' | 'granted' | 'denied' | 'not-supported' | 'error';

export const QRScanner = ({ onScan, onError }: QRScannerProps) => {
    const [cameraStatus, setCameraStatus] = useState<CameraStatus>('checking');
    const [errorMessage, setErrorMessage] = useState<string>('');

    const checkCameraSupport = useCallback(async () => {
        // Check if we're in a secure context (HTTPS or localhost)
        if (!window.isSecureContext) {
            setCameraStatus('not-supported');
            setErrorMessage('Camera requires HTTPS. Please use a secure connection.');
            return;
        }

        // Check if mediaDevices API is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setCameraStatus('not-supported');
            setErrorMessage('Camera is not supported on this device or browser.');
            return;
        }

        // Check if camera is available
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(device => device.kind === 'videoinput');

            if (videoDevices.length === 0) {
                setCameraStatus('not-supported');
                setErrorMessage('No camera found on this device.');
                return;
            }
        } catch {
            // enumerateDevices might fail, continue anyway
            console.log('Could not enumerate devices, will try to request permission');
        }

        // Request camera permission
        setCameraStatus('requesting');

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });

            // Permission granted, stop the test stream
            stream.getTracks().forEach(track => track.stop());
            setCameraStatus('granted');

        } catch (err) {
            const error = err as Error;
            console.error('Camera permission error:', error);

            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                setCameraStatus('denied');
                setErrorMessage('Camera access was denied. Please allow camera permission in your browser settings.');
            } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                setCameraStatus('not-supported');
                setErrorMessage('No camera found on this device.');
            } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
                setCameraStatus('error');
                setErrorMessage('Camera is in use by another application. Please close other apps and try again.');
            } else if (error.name === 'OverconstrainedError') {
                // Try again without constraints
                try {
                    const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
                    fallbackStream.getTracks().forEach(track => track.stop());
                    setCameraStatus('granted');
                    return;
                } catch {
                    setCameraStatus('error');
                    setErrorMessage('Could not access camera with required settings.');
                }
            } else if (error.name === 'SecurityError') {
                setCameraStatus('not-supported');
                setErrorMessage('Camera access is blocked. Please use HTTPS or check security settings.');
            } else {
                setCameraStatus('error');
                setErrorMessage(`Camera error: ${error.message || 'Unknown error occurred'}`);
            }

            if (onError) onError(error);
        }
    }, [onError]);

    useEffect(() => {
        queueMicrotask(() => checkCameraSupport());
    }, [checkCameraSupport]);

    const handleRetry = () => {
        setCameraStatus('checking');
        setErrorMessage('');
        checkCameraSupport();
    };

    const handleOpenSettings = () => {
        // For Telegram Mini Apps, we can try to open app settings
        if (window.Telegram?.WebApp) {
            window.Telegram.WebApp.showAlert(
                'Please go to your device settings and allow camera access for Telegram, then return and try again.'
            );
        }
    };

    // Render based on camera status
    if (cameraStatus === 'checking') {
        return (
            <div className={styles.statusContainer}>
                <div className={styles.spinner}></div>
                <p className={styles.statusText}>Checking camera...</p>
            </div>
        );
    }

    if (cameraStatus === 'requesting') {
        return (
            <div className={styles.statusContainer}>
                <Camera size={48} className={styles.icon} />
                <p className={styles.statusText}>Requesting camera permission...</p>
                <p className={styles.statusHint}>Please allow access to your camera</p>
            </div>
        );
    }

    if (cameraStatus === 'denied') {
        return (
            <div className={styles.statusContainer}>
                <CameraOff size={48} className={styles.iconError} />
                <p className={styles.statusText}>Camera Access Denied</p>
                <p className={styles.statusHint}>{errorMessage}</p>
                <div className={styles.buttonGroup}>
                    <button onClick={handleRetry} className={styles.retryButton}>
                        <RefreshCw size={20} />
                        Try Again
                    </button>
                    <button onClick={handleOpenSettings} className={styles.settingsButton}>
                        Open Settings
                    </button>
                </div>
            </div>
        );
    }

    if (cameraStatus === 'not-supported') {
        return (
            <div className={styles.statusContainer}>
                <AlertTriangle size={48} className={styles.iconWarning} />
                <p className={styles.statusText}>Camera Not Available</p>
                <p className={styles.statusHint}>{errorMessage}</p>
                <button onClick={handleRetry} className={styles.retryButton}>
                    <RefreshCw size={20} />
                    Try Again
                </button>
            </div>
        );
    }

    if (cameraStatus === 'error') {
        return (
            <div className={styles.statusContainer}>
                <AlertTriangle size={48} className={styles.iconError} />
                <p className={styles.statusText}>Camera Error</p>
                <p className={styles.statusHint}>{errorMessage}</p>
                <button onClick={handleRetry} className={styles.retryButton}>
                    <RefreshCw size={20} />
                    Try Again
                </button>
            </div>
        );
    }

    // Camera is granted - show scanner
    return (
        <div className={styles.scannerWrapper}>
            <Scanner
                onScan={(result) => {
                    if (result && result.length > 0) {
                        onScan(result[0].rawValue);
                    }
                }}
                onError={(error) => {
                    console.error("QR Scan Error:", error);
                    setCameraStatus('error');
                    setErrorMessage('Failed to start camera. Please try again.');
                    if (onError) onError(error);
                }}
                constraints={{
                    facingMode: 'environment',
                }}
                components={{
                    finder: false,
                }}
                styles={{
                    container: {
                        width: '100%',
                        height: '100%',
                    },
                    video: {
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                    },
                }}
            />
        </div>
    );
};
