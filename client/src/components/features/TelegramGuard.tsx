'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTelegram } from '@/lib/context/TelegramContext';
import { AppLoader } from '@/components/ui/AppLoader';

interface TelegramGuardProps {
    children: React.ReactNode;
}

// Pages that don't require Telegram
const PUBLIC_PATHS = ['/not-telegram', '/admin', '/activate'];

export const TelegramGuard = ({ children }: TelegramGuardProps) => {
    const router = useRouter();
    const pathname = usePathname();
    const { webApp, ready } = useTelegram();
    const [status, setStatus] = useState<'checking' | 'ok' | 'redirecting'>('checking');

    useEffect(() => {
        // Skip check for public paths
        if (PUBLIC_PATHS.some(path => pathname.startsWith(path))) {
            setStatus('ok');
            return;
        }

        // Wait for Telegram to initialize
        if (!ready) return;

        // Check if running in Telegram by checking initData
        // Real Telegram WebApp will have initData, mock/browser will not
        const isTelegram = webApp?.initData && webApp.initData.length > 0;

        if (!isTelegram) {
            // Not in Telegram - redirect to info page
            setStatus('redirecting');
            router.replace('/not-telegram');
        } else {
            setStatus('ok');
        }
    }, [ready, webApp, pathname, router]);

    // Show loader while checking (but not for public paths)
    if (status === 'checking') {
        if (PUBLIC_PATHS.some(path => pathname.startsWith(path))) {
            return <>{children}</>;
        }
        return <AppLoader message="Yuklanmoqda..." />;
    }

    // Redirecting - show loader
    if (status === 'redirecting') {
        return <AppLoader message="Yuklanmoqda..." />;
    }

    return <>{children}</>;
};
