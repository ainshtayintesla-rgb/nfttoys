import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { ClientProviders } from '@/components/ClientProviders';
import { Locale } from '@/lib/i18n';
import './globals.css';
import Script from 'next/script';

export const metadata: Metadata = {
    title: 'NFT Toys Platform',
    description: 'Premium NFT Toys Store on Telegram',
};

export default async function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const cookieStore = await cookies();
    const locale = (cookieStore.get('NEXT_LOCALE')?.value || 'en') as Locale;

    return (
        <html lang={locale} suppressHydrationWarning>
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
            <body suppressHydrationWarning>
                <ClientProviders initialLocale={locale}>
                    {children}
                </ClientProviders>
            </body>
        </html>
    );
}
