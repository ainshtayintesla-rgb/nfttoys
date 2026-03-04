'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IoBackspace, IoChevronBack, IoFingerPrint } from 'react-icons/io5';
import { TbFaceId } from 'react-icons/tb';

import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';

import styles from './PinAuthScreen.module.css';

const DIGIT_ROWS = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
] as const;

type SetupStep = 'enter' | 'repeat';

export type PinAuthScreenMode = 'setup' | 'confirm';

export interface PinAuthScreenDetail {
    label: string;
    value: string;
}

export type PinAuthScreenBiometricIconKind = 'face' | 'touch';

interface PinAuthScreenProps {
    open: boolean;
    mode: PinAuthScreenMode;
    subtitle?: string;
    backLabel: string;
    biometricLabel: string;
    errorMessage?: string;
    isSubmitting?: boolean;
    minLength?: number;
    maxLength?: number;
    biometricEnabled?: boolean;
    isBiometricLoading?: boolean;
    biometricIconKind?: PinAuthScreenBiometricIconKind;
    autoTriggerBiometric?: boolean;
    details?: PinAuthScreenDetail[];
    onSetupComplete?: (pin: string) => Promise<void> | void;
    onPinConfirm?: (pin: string) => Promise<void> | void;
    onBiometricConfirm?: () => Promise<void> | void;
    onSetupMismatch?: () => void;
    onPinChange?: () => void;
}

function trimPin(rawPin: string, maxLength: number): string {
    return rawPin.replace(/[^0-9]/g, '').slice(0, Math.max(1, maxLength));
}

function isPinLengthValid(pin: string, minLength: number, maxLength: number): boolean {
    return pin.length >= minLength && pin.length <= maxLength;
}

export const PinAuthScreen = ({
    open,
    mode,
    subtitle,
    backLabel,
    biometricLabel,
    errorMessage,
    isSubmitting = false,
    minLength = 4,
    maxLength = 12,
    biometricEnabled = false,
    isBiometricLoading = false,
    biometricIconKind = 'touch',
    autoTriggerBiometric = false,
    details,
    onSetupComplete,
    onPinConfirm,
    onBiometricConfirm,
    onSetupMismatch,
    onPinChange,
}: PinAuthScreenProps) => {
    const [mounted, setMounted] = useState(false);
    const [setupStep, setSetupStep] = useState<SetupStep>('enter');
    const [setupPin, setSetupPin] = useState('');
    const [repeatPin, setRepeatPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [setupMismatch, setSetupMismatch] = useState(false);
    const autoBiometricTriggeredRef = useRef(false);
    const mismatchTimerRef = useRef<number | null>(null);

    useBodyScrollLock(open);

    useEffect(() => {
        queueMicrotask(() => {
            setMounted(true);
        });
    }, []);

    useEffect(() => {
        if (!open || mode !== 'confirm' || !biometricEnabled || !autoTriggerBiometric || !onBiometricConfirm) {
            return;
        }

        if (autoBiometricTriggeredRef.current) {
            return;
        }

        autoBiometricTriggeredRef.current = true;
        void onBiometricConfirm();
    }, [autoTriggerBiometric, biometricEnabled, mode, onBiometricConfirm, open]);

    useEffect(() => {
        return () => {
            if (mismatchTimerRef.current !== null) {
                window.clearTimeout(mismatchTimerRef.current);
            }
        };
    }, []);

    const activePin = useMemo(() => {
        if (mode === 'setup') {
            return setupStep === 'enter' ? setupPin : repeatPin;
        }

        return confirmPin;
    }, [confirmPin, mode, repeatPin, setupPin, setupStep]);

    const slots = useMemo(() => {
        const length = isSubmitting ? Math.min(4, maxLength) : maxLength;
        return Array.from({ length }, (_, index) => index);
    }, [isSubmitting, maxLength]);

    const setupCanContinue = useMemo(() => {
        if (setupStep === 'enter') {
            return isPinLengthValid(setupPin, minLength, maxLength);
        }

        return isPinLengthValid(repeatPin, minLength, maxLength);
    }, [maxLength, minLength, repeatPin, setupPin, setupStep]);

    const confirmCanSubmit = useMemo(() => {
        return isPinLengthValid(confirmPin, minLength, maxLength);
    }, [confirmPin, maxLength, minLength]);

    const setNextPinValue = (nextPin: string) => {
        if (mode === 'setup') {
            if (setupStep === 'enter') {
                setSetupPin(nextPin);
            } else {
                setRepeatPin(nextPin);
            }
        } else {
            setConfirmPin(nextPin);
        }

        onPinChange?.();
    };

    const handleDigitClick = (digit: string) => {
        if (isSubmitting) {
            return;
        }

        const nextPin = trimPin(`${activePin}${digit}`, maxLength);
        setNextPinValue(nextPin);
    };

    const handleBackspace = () => {
        if (isSubmitting || !activePin.length) {
            return;
        }

        const nextPin = activePin.slice(0, -1);
        setNextPinValue(nextPin);
    };

    const handleSetupContinue = useCallback(async () => {
        if (!setupCanContinue || isSubmitting) {
            return;
        }

        if (setupStep === 'enter') {
            setSetupStep('repeat');
            setRepeatPin('');
            setSetupMismatch(false);
            onPinChange?.();
            return;
        }

        if (repeatPin !== setupPin) {
            setSetupMismatch(true);
            setRepeatPin('');
            onSetupMismatch?.();
            if (mismatchTimerRef.current !== null) {
                window.clearTimeout(mismatchTimerRef.current);
            }
            mismatchTimerRef.current = window.setTimeout(() => {
                setSetupMismatch(false);
                mismatchTimerRef.current = null;
            }, 420);
            return;
        }

        if (onSetupComplete) {
            await onSetupComplete(setupPin);
        }
    }, [
        isSubmitting,
        onPinChange,
        onSetupComplete,
        onSetupMismatch,
        repeatPin,
        setupCanContinue,
        setupPin,
        setupStep,
    ]);

    const handleConfirmSubmit = useCallback(async () => {
        if (!confirmCanSubmit || isSubmitting || !onPinConfirm) {
            return;
        }

        const pin = confirmPin;
        setConfirmPin('');
        onPinChange?.();
        await onPinConfirm(pin);
    }, [confirmCanSubmit, confirmPin, isSubmitting, onPinChange, onPinConfirm]);

    const handleBackToSetupEnter = () => {
        if (isSubmitting) {
            return;
        }

        setSetupStep('enter');
        setSetupPin('');
        setRepeatPin('');
        setSetupMismatch(false);
        onPinChange?.();
    };

    const handleBiometricClick = () => {
        if (isSubmitting || isBiometricLoading || !biometricEnabled || !onBiometricConfirm) {
            return;
        }

        void onBiometricConfirm();
    };

    const autoActionKeyRef = useRef('');

    useEffect(() => {
        if (!open || isSubmitting) {
            autoActionKeyRef.current = '';
            return;
        }

        if (mode === 'setup' && setupStep === 'enter' && setupCanContinue) {
            const actionKey = `setup-enter:${setupPin}`;

            if (autoActionKeyRef.current === actionKey) {
                return;
            }

            autoActionKeyRef.current = actionKey;

            const timer = window.setTimeout(() => {
                void handleSetupContinue();
            }, 100);

            return () => {
                window.clearTimeout(timer);
            };
        }

        if (mode === 'setup' && setupStep === 'repeat' && setupCanContinue) {
            const actionKey = `setup-repeat:${setupPin}:${repeatPin}`;

            if (autoActionKeyRef.current === actionKey) {
                return;
            }

            autoActionKeyRef.current = actionKey;

            const timer = window.setTimeout(() => {
                void handleSetupContinue();
            }, 100);

            return () => {
                window.clearTimeout(timer);
            };
        }

        if (mode === 'confirm' && confirmCanSubmit) {
            const actionKey = `confirm:${confirmPin}`;

            if (autoActionKeyRef.current === actionKey) {
                return;
            }

            autoActionKeyRef.current = actionKey;

            const timer = window.setTimeout(() => {
                void handleConfirmSubmit();
            }, 100);

            return () => {
                window.clearTimeout(timer);
            };
        }

        autoActionKeyRef.current = '';
    }, [
        confirmCanSubmit,
        confirmPin,
        handleConfirmSubmit,
        handleSetupContinue,
        isSubmitting,
        mode,
        open,
        repeatPin,
        setupCanContinue,
        setupPin,
        setupStep,
    ]);

    const showSetupBackButton = mode === 'setup' && setupStep === 'repeat';
    const showBiometricButton = mode === 'confirm' && biometricEnabled;

    if (!mounted || !open) {
        return null;
    }

    return createPortal(
        <div className={styles.screen}>
            <div className={styles.content}>
                {subtitle && <p className={styles.subtitle}>{subtitle}</p>}

                {mode === 'confirm' && details?.length ? (
                    <div className={styles.details}>
                        {details.map((detail) => (
                            <div key={`${detail.label}:${detail.value}`} className={styles.detailRow}>
                                <span className={styles.detailLabel}>{detail.label}</span>
                                <span className={styles.detailValue}>{detail.value}</span>
                            </div>
                        ))}
                    </div>
                ) : null}

                <div className={`${styles.dots} ${setupMismatch ? styles.dotsShake : ''}`}>
                    {slots.map((slotIndex) => {
                        const isFilled = slotIndex < activePin.length;
                        const dotClassName = mode === 'setup'
                            ? styles.dotSetup
                            : styles.dotConfirm;

                        return (
                            <span
                                key={slotIndex}
                                className={[
                                    styles.dot,
                                    dotClassName,
                                    isSubmitting || isFilled ? styles.dotFilled : '',
                                    isSubmitting ? styles.dotLoading : '',
                                    setupMismatch ? styles.dotMismatch : '',
                                ].join(' ')}
                                style={isSubmitting
                                    ? ({ '--pin-dot-delay': `${slotIndex * 0.09}s` } as React.CSSProperties)
                                    : undefined}
                            />
                        );
                    })}
                </div>

                {errorMessage ? <p className={styles.error}>{errorMessage}</p> : <div className={styles.errorSpacer} />}

                <div className={styles.keypad}>
                    {DIGIT_ROWS.map((row) => (
                        <div key={row.join('-')} className={styles.keypadRow}>
                            {row.map((digit) => (
                                <button
                                    key={digit}
                                    type="button"
                                    className={styles.keyButton}
                                    onClick={() => {
                                        handleDigitClick(digit);
                                    }}
                                    disabled={isSubmitting}
                                >
                                    {digit}
                                </button>
                            ))}
                        </div>
                    ))}

                    <div className={styles.keypadRow}>
                        {showSetupBackButton ? (
                            <button
                                type="button"
                                className={`${styles.keyButton} ${styles.keyActionButton}`}
                                onClick={handleBackToSetupEnter}
                                disabled={isSubmitting}
                                aria-label={backLabel}
                                title={backLabel}
                            >
                                <IoChevronBack size={22} />
                            </button>
                        ) : showBiometricButton ? (
                            <button
                                type="button"
                                className={`${styles.keyButton} ${styles.keyActionButton}`}
                                onClick={handleBiometricClick}
                                disabled={isSubmitting || isBiometricLoading}
                                aria-label={biometricLabel}
                                title={biometricLabel}
                            >
                                {biometricIconKind === 'face' ? (
                                    <TbFaceId
                                        size={24}
                                        className={isBiometricLoading ? styles.keyIconLoading : undefined}
                                    />
                                ) : (
                                    <IoFingerPrint
                                        size={24}
                                        className={isBiometricLoading ? styles.keyIconLoading : undefined}
                                    />
                                )}
                            </button>
                        ) : (
                            <span className={styles.keyButtonPlaceholder} />
                        )}

                        <button
                            type="button"
                            className={styles.keyButton}
                            onClick={() => {
                                handleDigitClick('0');
                            }}
                            disabled={isSubmitting}
                        >
                            0
                        </button>

                        <button
                            type="button"
                            className={`${styles.keyButton} ${styles.keyActionButton}`}
                            onClick={handleBackspace}
                            disabled={isSubmitting || !activePin.length}
                            aria-label="Backspace"
                        >
                            <IoBackspace size={22} />
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
};
