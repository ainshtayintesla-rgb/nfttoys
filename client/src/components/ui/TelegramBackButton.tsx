'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram } from '@/lib/context/TelegramContext';

interface TelegramBackButtonProps {
    /** Route to navigate to when back button is clicked. If not provided, uses router.back() */
    href?: string;
    /** Callback function called when back button is clicked (before navigation) */
    onBack?: () => void;
}

/**
 * Telegram BackButton component that shows/hides the native Telegram back button.
 * Use this component on pages where you want to show a back button in the Telegram header.
 * 
 * @example
 * // Navigate to specific route
 * <TelegramBackButton href="/profile" />
 * 
 * @example
 * // Use browser history
 * <TelegramBackButton />
 * 
 * @example
 * // With callback
 * <TelegramBackButton href="/home" onBack={() => console.log('Going back')} />
 */
export function TelegramBackButton({ href, onBack }: TelegramBackButtonProps) {
    const router = useRouter();
    const { webApp, haptic } = useTelegram();

    useEffect(() => {
        if (!webApp?.BackButton) return;

        const handleBack = () => {
            // Haptic feedback
            haptic.impact('light');

            // Call optional callback
            onBack?.();

            // Navigate
            if (href) {
                router.push(href);
            } else {
                router.back();
            }
        };

        // Show the back button and register click handler
        webApp.BackButton.show();
        webApp.BackButton.onClick(handleBack);

        // Cleanup: hide button and remove handler on unmount
        return () => {
            webApp.BackButton.offClick(handleBack);
            webApp.BackButton.hide();
        };
    }, [webApp, href, onBack, router, haptic]);

    // This component doesn't render anything - it controls the native Telegram button
    return null;
}
