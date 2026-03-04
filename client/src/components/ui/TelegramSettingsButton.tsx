'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTelegram } from '@/lib/context/TelegramContext';

const SETTINGS_PATH = '/settings';

export const TelegramSettingsButton = () => {
    const router = useRouter();
    const pathname = usePathname();
    const { webApp, ready, haptic } = useTelegram();

    const settingsButton = webApp?.SettingsButton;
    const shouldShow = Boolean(
        ready
        && webApp?.initData
        && settingsButton
        && !pathname.startsWith(SETTINGS_PATH)
    );

    useEffect(() => {
        if (!settingsButton) {
            return;
        }

        if (!shouldShow) {
            settingsButton.hide();
            return;
        }

        const handleSettingsClick = () => {
            haptic.impact('light');
            router.push(SETTINGS_PATH);
        };

        settingsButton.show();
        settingsButton.onClick(handleSettingsClick);

        return () => {
            settingsButton.offClick(handleSettingsClick);
            settingsButton.hide();
        };
    }, [haptic, router, settingsButton, shouldShow]);

    return null;
};
