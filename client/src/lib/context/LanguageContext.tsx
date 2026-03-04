'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { translations, Locale, TranslationKey } from '@/lib/i18n';
import { useTelegram } from './TelegramContext';

export type { Locale };

const STORAGE_KEY = 'user_locale';
const LOCALE_COOKIE_KEY = 'NEXT_LOCALE';
const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const SUPPORTED_LOCALES: Locale[] = ['en', 'ru', 'uz'];

// Helper to check if CloudStorage is available (requires TG WebApp 6.9+)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isCloudStorageAvailable = (webApp: any): boolean => {
    if (!webApp) return false;
    const version = parseFloat(webApp.version || '0');
    return version >= 6.9 && !!webApp.CloudStorage;
};

const isLocale = (value: unknown): value is Locale => {
    return typeof value === 'string' && SUPPORTED_LOCALES.includes(value as Locale);
};

const readLocaleCookie = (): Locale | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE_KEY}=([^;]*)`));
    if (!match?.[1]) {
        return null;
    }

    const cookieValue = decodeURIComponent(match[1]);
    return isLocale(cookieValue) ? cookieValue : null;
};

const writeLocaleCookie = (locale: Locale) => {
    if (typeof window === 'undefined') {
        return;
    }

    document.cookie = `${LOCALE_COOKIE_KEY}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
};

const readLocaleLocalStorage = (): Locale | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return isLocale(saved) ? saved : null;
    } catch {
        return null;
    }
};

const writeLocaleLocalStorage = (locale: Locale) => {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        localStorage.setItem(STORAGE_KEY, locale);
    } catch {
        // localStorage might not be available
    }
};

const syncLocaleToBrowserStorage = (locale: Locale) => {
    writeLocaleLocalStorage(locale);
    writeLocaleCookie(locale);
};

const resolveTelegramLocale = (languageCode?: string): Locale | null => {
    if (!languageCode) {
        return null;
    }

    const normalized = languageCode.toLowerCase().split('-')[0];
    return isLocale(normalized) ? normalized : null;
};

interface LanguageContextType {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: (key: TranslationKey) => string;
    isLoading: boolean;
}

const LanguageContext = createContext<LanguageContextType>({
    locale: 'en',
    setLocale: () => { },
    t: (key) => key,
    isLoading: true,
});

export const useLanguage = () => useContext(LanguageContext);

export const LanguageProvider = ({ children, initialLocale = 'en' }: { children: React.ReactNode; initialLocale?: Locale }) => {
    const { webApp, user } = useTelegram();
    const [locale, setLocalState] = useState<Locale>(initialLocale);
    const [isLoading, setIsLoading] = useState(true);

    // Load saved language with priority: CloudStorage -> cookie/localStorage -> Telegram user language -> initialLocale
    useEffect(() => {
        let cancelled = false;

        const browserLocale = readLocaleCookie() ?? readLocaleLocalStorage();
        const telegramLocale = resolveTelegramLocale(user?.language_code);
        const fallbackLocale = browserLocale ?? telegramLocale ?? initialLocale;

        const finishWithLocale = (nextLocale: Locale) => {
            if (cancelled) {
                return;
            }

            setLocalState(nextLocale);
            syncLocaleToBrowserStorage(nextLocale);
            setIsLoading(false);
        };

        const loadSavedLocale = () => {
            if (!isCloudStorageAvailable(webApp)) {
                finishWithLocale(fallbackLocale);
                return;
            }

            try {
                webApp!.CloudStorage.getItem(STORAGE_KEY, (error: Error | null, value?: string) => {
                    if (cancelled) {
                        return;
                    }

                    if (error) {
                        console.warn('CloudStorage getItem error:', error);
                        finishWithLocale(fallbackLocale);
                        return;
                    }

                    if (isLocale(value)) {
                        finishWithLocale(value);
                        return;
                    }

                    finishWithLocale(fallbackLocale);

                    if (telegramLocale && !browserLocale) {
                        webApp!.CloudStorage.setItem(STORAGE_KEY, telegramLocale);
                    }
                });
            } catch (e) {
                console.warn('CloudStorage error:', e);
                finishWithLocale(fallbackLocale);
            }
        };

        loadSavedLocale();

        return () => {
            cancelled = true;
        };
    }, [initialLocale, user?.language_code, webApp]);

    useEffect(() => {
        if (typeof document !== 'undefined') {
            document.documentElement.lang = locale;
        }
    }, [locale]);

    const setLocale = useCallback((newLocale: Locale) => {
        setLocalState(newLocale);
        syncLocaleToBrowserStorage(newLocale);

        if (isCloudStorageAvailable(webApp)) {
            try {
                webApp!.CloudStorage.setItem(STORAGE_KEY, newLocale, (error: Error | null) => {
                    if (error) {
                        console.warn('CloudStorage setItem error:', error);
                    }
                });
            } catch (e) {
                console.warn('CloudStorage save error:', e);
            }
        }
    }, [webApp]);

    const t = useCallback((key: TranslationKey) => {
        return translations[locale][key] || translations['en'][key] || key;
    }, [locale]);

    return (
        <LanguageContext.Provider value={{ locale, setLocale, t, isLoading }}>
            {children}
        </LanguageContext.Provider>
    );
};
