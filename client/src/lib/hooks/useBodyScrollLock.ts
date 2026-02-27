import { useEffect } from 'react';

interface LockedStyles {
    bodyOverflow: string;
    bodyPosition: string;
    bodyTop: string;
    bodyWidth: string;
    bodyTouchAction: string;
    bodyOverscrollBehaviorY: string;
    htmlOverflow: string;
    scrollY: number;
}

let activeLockCount = 0;
let lockedStyles: LockedStyles | null = null;

const lockDocumentScroll = () => {
    if (typeof window === 'undefined') {
        return;
    }

    if (activeLockCount > 0) {
        activeLockCount += 1;
        return;
    }

    const body = document.body;
    const html = document.documentElement;
    const scrollY = window.scrollY;

    lockedStyles = {
        bodyOverflow: body.style.overflow,
        bodyPosition: body.style.position,
        bodyTop: body.style.top,
        bodyWidth: body.style.width,
        bodyTouchAction: body.style.touchAction,
        bodyOverscrollBehaviorY: body.style.overscrollBehaviorY,
        htmlOverflow: html.style.overflow,
        scrollY,
    };

    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.touchAction = 'none';
    body.style.overscrollBehaviorY = 'none';
    html.style.overflow = 'hidden';

    activeLockCount = 1;
};

const unlockDocumentScroll = () => {
    if (typeof window === 'undefined' || activeLockCount === 0) {
        return;
    }

    activeLockCount -= 1;

    if (activeLockCount > 0 || !lockedStyles) {
        return;
    }

    const body = document.body;
    const html = document.documentElement;

    body.style.overflow = lockedStyles.bodyOverflow;
    body.style.position = lockedStyles.bodyPosition;
    body.style.top = lockedStyles.bodyTop;
    body.style.width = lockedStyles.bodyWidth;
    body.style.touchAction = lockedStyles.bodyTouchAction;
    body.style.overscrollBehaviorY = lockedStyles.bodyOverscrollBehaviorY;
    html.style.overflow = lockedStyles.htmlOverflow;

    window.scrollTo(0, lockedStyles.scrollY);
    lockedStyles = null;
};

export function useBodyScrollLock(locked: boolean) {
    useEffect(() => {
        if (!locked) {
            return;
        }

        lockDocumentScroll();

        return () => {
            unlockDocumentScroll();
        };
    }, [locked]);
}
