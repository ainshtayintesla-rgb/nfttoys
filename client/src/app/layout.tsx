import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { ClientProviders } from '@/components/ClientProviders';
import { Locale } from '@/lib/i18n';
import type { ThemeSource } from '@/lib/context/ThemeContext';
import './globals.css';
import Script from 'next/script';

export const metadata: Metadata = {
    title: 'NFT Toys Platform',
    description: 'Premium NFT Toys Store on Telegram',
};

type ThemeMode = 'dark' | 'light';
const DEFAULT_LOCALE: Locale = 'en';
const DEFAULT_THEME: ThemeMode = 'light';
const DEFAULT_THEME_SOURCE: ThemeSource = 'auto';

const parseLocale = (value: string | undefined): Locale => {
    if (value === 'en' || value === 'ru' || value === 'uz') {
        return value;
    }

    return DEFAULT_LOCALE;
};

const parseTheme = (value: string | undefined): ThemeMode | null => {
    if (value === 'light' || value === 'dark') {
        return value;
    }

    return null;
};

const parseThemeSource = (value: string | undefined): ThemeSource | null => {
    if (value === 'manual' || value === 'auto') {
        return value;
    }

    return null;
};

const getThemeBackground = (theme: ThemeMode): string => {
    return theme === 'light' ? '#f5f8fd' : '#121212';
};

export default async function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const cookieStore = await cookies();
    const locale = parseLocale(cookieStore.get('NEXT_LOCALE')?.value);
    const cookieTheme = parseTheme(cookieStore.get('app_theme_mode')?.value);
    const cookieThemeSource = parseThemeSource(cookieStore.get('app_theme_source')?.value);

    const initialTheme = cookieTheme ?? DEFAULT_THEME;
    const initialThemeSource = cookieThemeSource ?? (cookieTheme ? 'manual' : DEFAULT_THEME_SOURCE);
    const ssrTheme = cookieTheme && initialThemeSource === 'manual' ? cookieTheme : null;
    const themeBackground = ssrTheme ? getThemeBackground(ssrTheme) : undefined;

    return (
        <html
            lang={locale}
            data-theme={ssrTheme ?? undefined}
            suppressHydrationWarning
            style={
                ssrTheme
                    ? { colorScheme: ssrTheme, backgroundColor: themeBackground }
                    : { colorScheme: 'light dark' }
            }
        >
            <head>
                {/* Disable zoom */}
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
                />
                {/* Telegram Web App Script */}
                <Script
                    src="https://telegram.org/js/telegram-web-app.js"
                    strategy="beforeInteractive"
                />
            </head>
            <body suppressHydrationWarning style={themeBackground ? { backgroundColor: themeBackground } : undefined}>
                <ClientProviders
                    initialLocale={locale}
                    initialTheme={initialTheme}
                    initialThemeSource={initialThemeSource}
                >
                    {children}
                </ClientProviders>
            </body>
        </html>
    );
}
