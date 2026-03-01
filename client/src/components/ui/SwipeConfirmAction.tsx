'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';

import styles from './SwipeConfirmAction.module.css';

const SWIPE_TRACK_HORIZONTAL_PADDING = 6;
const SWIPE_HANDLE_SIZE = 44;
const SWIPE_COMPLETE_THRESHOLD = 0.92;

interface SwipeConfirmActionProps {
    label: string;
    onConfirm: () => void | Promise<void>;
    disabled?: boolean;
    loading?: boolean;
    resetKey?: string | number | null;
    className?: string;
}

function cx(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export function SwipeConfirmAction({
    label,
    onConfirm,
    disabled = false,
    loading = false,
    resetKey,
    className,
}: SwipeConfirmActionProps) {
    const trackRef = useRef<HTMLDivElement | null>(null);
    const pointerIdRef = useRef<number | null>(null);
    const startXRef = useRef(0);
    const startOffsetRef = useRef(0);

    const [offset, setOffset] = useState(0);
    const [maxOffset, setMaxOffset] = useState(0);
    const [isSwiping, setIsSwiping] = useState(false);
    const [isTriggering, setIsTriggering] = useState(false);

    const recalculateSwipeBounds = useCallback(() => {
        const trackElement = trackRef.current;
        if (!trackElement) {
            setMaxOffset(0);
            return;
        }

        const nextMaxOffset = Math.max(
            0,
            trackElement.clientWidth - (SWIPE_TRACK_HORIZONTAL_PADDING * 2) - SWIPE_HANDLE_SIZE,
        );

        setMaxOffset(nextMaxOffset);
        setOffset((current) => Math.min(current, nextMaxOffset));
    }, []);

    useEffect(() => {
        const frameId = window.requestAnimationFrame(recalculateSwipeBounds);
        const handleResize = () => {
            recalculateSwipeBounds();
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('resize', handleResize);
        };
    }, [recalculateSwipeBounds]);

    useEffect(() => {
        pointerIdRef.current = null;
        setOffset(0);
        setIsSwiping(false);
    }, [resetKey]);

    const resetPointerState = (target?: EventTarget | null, pointerId?: number) => {
        if (
            target
            && typeof pointerId === 'number'
            && target instanceof Element
            && target.hasPointerCapture(pointerId)
        ) {
            target.releasePointerCapture(pointerId);
        }

        pointerIdRef.current = null;
        setIsSwiping(false);
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (disabled || loading || isTriggering || maxOffset <= 0) {
            return;
        }

        pointerIdRef.current = event.pointerId;
        startXRef.current = event.clientX;
        startOffsetRef.current = offset;
        setIsSwiping(true);
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (pointerIdRef.current !== event.pointerId || disabled || loading || isTriggering) {
            return;
        }

        const deltaX = event.clientX - startXRef.current;
        const nextOffset = Math.min(maxOffset, Math.max(0, startOffsetRef.current + deltaX));
        setOffset(nextOffset);
    };

    const finalizeSwipe = async (event: React.PointerEvent<HTMLButtonElement>) => {
        if (pointerIdRef.current !== event.pointerId) {
            return;
        }

        resetPointerState(event.currentTarget, event.pointerId);

        if (disabled || loading || isTriggering) {
            setOffset(0);
            return;
        }

        const reachedEnd = maxOffset > 0 && offset >= (maxOffset * SWIPE_COMPLETE_THRESHOLD);
        if (!reachedEnd) {
            setOffset(0);
            return;
        }

        setOffset(maxOffset);
        setIsTriggering(true);

        try {
            await onConfirm();
        } finally {
            setIsTriggering(false);
            setOffset(0);
        }
    };

    const handlePointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (pointerIdRef.current !== event.pointerId) {
            return;
        }

        resetPointerState(event.currentTarget, event.pointerId);
        setOffset(0);
    };

    return (
        <div className={cx(styles.root, className)}>
            <div className={styles.track} ref={trackRef}>
                <div
                    className={styles.fill}
                    style={{ width: `${SWIPE_HANDLE_SIZE + offset + (SWIPE_TRACK_HORIZONTAL_PADDING * 2)}px` }}
                />
                <span className={styles.label}>{label}</span>
                <button
                    type="button"
                    className={cx(styles.handle, isSwiping && styles.handleActive)}
                    style={{ transform: `translateX(${offset}px)` }}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={finalizeSwipe}
                    onPointerCancel={handlePointerCancel}
                    disabled={disabled || loading || isTriggering || maxOffset <= 0}
                    aria-label={label}
                >
                    {loading ? (
                        <Loader2 size={20} className={styles.spinner} />
                    ) : (
                        <ArrowRight size={20} />
                    )}
                </button>
            </div>
        </div>
    );
}
