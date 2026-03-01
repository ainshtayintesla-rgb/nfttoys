'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { CheckCircle2 } from 'lucide-react';

import { SwipeConfirmAction } from './SwipeConfirmAction';
import styles from './SwipeConfirmWithSuccess.module.css';

interface SwipeConfirmWithSuccessProps {
    label: string;
    onConfirm: () => void | boolean | Promise<void | boolean>;
    isSubmitting?: boolean;
    isSuccess?: boolean;
    disabled?: boolean;
    resetKey?: string | number | null;
    autoCloseMs?: number;
    onSuccessAutoClose?: () => void;
    className?: string;
    swipeClassName?: string;
    successIconClassName?: string;
}

function cx(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export function SwipeConfirmWithSuccess({
    label,
    onConfirm,
    isSubmitting = false,
    isSuccess = false,
    disabled = false,
    resetKey,
    autoCloseMs = 5000,
    onSuccessAutoClose,
    className,
    swipeClassName,
    successIconClassName,
}: SwipeConfirmWithSuccessProps) {
    const autoCloseTimerRef = useRef<number | null>(null);

    const clearAutoCloseTimer = useCallback(() => {
        if (autoCloseTimerRef.current !== null) {
            window.clearTimeout(autoCloseTimerRef.current);
            autoCloseTimerRef.current = null;
        }
    }, []);

    useEffect(() => () => {
        clearAutoCloseTimer();
    }, [clearAutoCloseTimer]);

    useEffect(() => {
        if (!isSuccess || typeof onSuccessAutoClose !== 'function') {
            clearAutoCloseTimer();
            return;
        }

        clearAutoCloseTimer();
        autoCloseTimerRef.current = window.setTimeout(() => {
            autoCloseTimerRef.current = null;
            onSuccessAutoClose();
        }, autoCloseMs);

        return () => {
            clearAutoCloseTimer();
        };
    }, [autoCloseMs, clearAutoCloseTimer, isSuccess, onSuccessAutoClose]);

    const handleConfirm = useCallback(async () => {
        await onConfirm();
    }, [onConfirm]);

    return (
        <div className={cx(styles.root, className)}>
            <SwipeConfirmAction
                label={label}
                onConfirm={handleConfirm}
                disabled={disabled || isSubmitting || isSuccess}
                loading={isSubmitting}
                resetKey={resetKey}
                className={swipeClassName}
            />

            {isSuccess && (
                <div className={cx(styles.successIcon, successIconClassName)} aria-hidden="true">
                    <CheckCircle2 size={18} />
                </div>
            )}
        </div>
    );
}
