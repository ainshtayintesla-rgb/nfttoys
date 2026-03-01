'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Loader2, X } from 'lucide-react';

import styles from './SwipeConfirmAction.module.css';

const SWIPE_TRACK_HORIZONTAL_PADDING = 6;
const SWIPE_HANDLE_SIZE = 44;
const SWIPE_COMPLETE_THRESHOLD = 0.92;

type SwipeResult = 'success' | 'error' | null;

interface SwipeConfirmActionProps {
    label: string;
    onConfirm: () => Promise<boolean> | boolean;
    disabled?: boolean;
    loading?: boolean;
    resetKey?: string | number;
    className?: string;
}

function cx(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export const SwipeConfirmAction = ({
    label,
    onConfirm,
    disabled = false,
    loading = false,
    resetKey,
    className,
}: SwipeConfirmActionProps) => {
    const trackRef = useRef<HTMLDivElement | null>(null);
    const pointerIdRef = useRef<number | null>(null);
    const pointerStartXRef = useRef(0);
    const pointerStartOffsetRef = useRef(0);

    const [offset, setOffset] = useState(0);
    const [maxOffset, setMaxOffset] = useState(0);
    const [isSwiping, setIsSwiping] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [result, setResult] = useState<SwipeResult>(null);

    const isBusy = loading || isSubmitting;

    const recalculateBounds = useCallback(() => {
        const trackElement = trackRef.current;

        if (!trackElement) {
            return;
        }

        const trackWidth = trackElement.getBoundingClientRect().width;
        const nextMaxOffset = Math.max(0, trackWidth - SWIPE_HANDLE_SIZE - (SWIPE_TRACK_HORIZONTAL_PADDING * 2));

        setMaxOffset(nextMaxOffset);
        setOffset((current) => Math.min(current, nextMaxOffset));
    }, []);

    useEffect(() => {
        const frameId = window.requestAnimationFrame(recalculateBounds);
        const handleResize = () => {
            recalculateBounds();
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('resize', handleResize);
        };
    }, [recalculateBounds]);

    useEffect(() => {
        pointerIdRef.current = null;
        pointerStartXRef.current = 0;
        pointerStartOffsetRef.current = 0;
        setOffset(0);
        setIsSwiping(false);
        setResult(null);
    }, [resetKey]);

    const runConfirm = useCallback(async () => {
        setIsSubmitting(true);
        setResult(null);

        try {
            const success = await onConfirm();

            if (success) {
                setResult('success');
                setOffset(maxOffset);
                return;
            }

            setResult('error');
            setOffset(0);
        } catch {
            setResult('error');
            setOffset(0);
        } finally {
            setIsSubmitting(false);
        }
    }, [maxOffset, onConfirm]);

    const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (disabled || isBusy || maxOffset <= 0) {
            return;
        }

        pointerIdRef.current = event.pointerId;
        pointerStartXRef.current = event.clientX;
        pointerStartOffsetRef.current = offset;
        setIsSwiping(true);
        setResult(null);

        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (pointerIdRef.current !== event.pointerId || isBusy) {
            return;
        }

        const deltaX = event.clientX - pointerStartXRef.current;
        const nextOffset = Math.min(maxOffset, Math.max(0, pointerStartOffsetRef.current + deltaX));
        setOffset(nextOffset);
    };

    const finalizeSwipe = async (event: React.PointerEvent<HTMLButtonElement>) => {
        if (pointerIdRef.current !== event.pointerId) {
            return;
        }

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        pointerIdRef.current = null;
        pointerStartXRef.current = 0;
        pointerStartOffsetRef.current = 0;
        setIsSwiping(false);

        if (disabled || isBusy) {
            setOffset(0);
            return;
        }

        const reachedEnd = maxOffset > 0 && offset >= (maxOffset * SWIPE_COMPLETE_THRESHOLD);

        if (!reachedEnd) {
            setOffset(0);
            return;
        }

        setOffset(maxOffset);
        await runConfirm();
    };

    const handlePointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (pointerIdRef.current !== event.pointerId) {
            return;
        }

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        pointerIdRef.current = null;
        pointerStartXRef.current = 0;
        pointerStartOffsetRef.current = 0;
        setIsSwiping(false);

        if (!isBusy) {
            setOffset(0);
        }
    };

    return (
        <div className={cx(styles.swipeConfirm, className)}>
            <div className={styles.swipeTrack} ref={trackRef}>
                <div
                    className={styles.swipeFill}
                    style={{ width: `${SWIPE_HANDLE_SIZE + offset + (SWIPE_TRACK_HORIZONTAL_PADDING * 2)}px` }}
                />
                <span className={styles.swipeLabel}>{label}</span>
                <button
                    type="button"
                    className={cx(styles.swipeHandle, isSwiping && styles.swipeHandleActive)}
                    style={{ transform: `translateX(${offset}px)` }}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={finalizeSwipe}
                    onPointerCancel={handlePointerCancel}
                    disabled={disabled || isBusy}
                    aria-label={label}
                >
                    {isBusy ? (
                        <Loader2 size={20} className={styles.swipeSpinner} />
                    ) : (
                        <ArrowRight size={20} />
                    )}
                </button>
            </div>

            {result && (
                <div className={styles.swipeResultRow}>
                    <span
                        className={cx(
                            styles.swipeResultIcon,
                            result === 'success' ? styles.swipeResultSuccess : styles.swipeResultError,
                        )}
                    >
                        {result === 'success' ? <Check size={12} /> : <X size={12} strokeWidth={3} />}
                    </span>
                </div>
            )}
        </div>
    );
};
