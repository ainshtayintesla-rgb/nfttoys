'use client';

import { TelegramProvider } from '@/lib/context/TelegramContext';
import { ThemeProvider } from '@/lib/context/ThemeContext';
import { LanguageProvider } from '@/lib/context/LanguageContext';
import { AnimationProvider } from '@/lib/context/AnimationContext';
import { NotificationProvider } from '@/lib/context/NotificationContext';
import { TelegramGuard } from '@/components/features/TelegramGuard';
import { InitialSettingsDrawer } from '@/components/features/InitialSettingsDrawer';
import { Locale } from '@/lib/i18n';

interface ClientProvidersProps {
    children: React.ReactNode;
    initialLocale: Locale;
}

export const ClientProviders = ({ children, initialLocale }: ClientProvidersProps) => {
    return (
        <TelegramProvider>
            <ThemeProvider>
                <LanguageProvider initialLocale={initialLocale}>
                    <AnimationProvider>
                        <NotificationProvider>
                            <TelegramGuard>
                                <main className="app-container">
                                    {children}
                                </main>
                                <InitialSettingsDrawer />
                            </TelegramGuard>
                        </NotificationProvider>
                    </AnimationProvider>
                </LanguageProvider>
            </ThemeProvider>
        </TelegramProvider>
    );
};
