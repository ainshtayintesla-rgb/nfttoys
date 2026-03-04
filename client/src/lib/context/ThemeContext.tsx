'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useTelegram } from './TelegramContext';

const THEME_STORAGE_KEY = 'app_theme_mode';
const THEME_COOKIE_KEY = 'app_theme_mode';
const THEME_SOURCE_STORAGE_KEY = 'app_theme_source';
const THEME_SOURCE_COOKIE_KEY = 'app_theme_source';
const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const DEFAULT_THEME: ThemeMode = 'light';
const DEFAULT_THEME_SOURCE: ThemeSource = 'auto';

export type ThemeMode = 'dark' | 'light';
export type ThemeSource = 'manual' | 'auto';

interface ThemeContextType {
    theme: ThemeMode;
    setTheme: (theme: ThemeMode) => void;
    isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
    theme: DEFAULT_THEME,
    setTheme: () => { },
    isLoading: true,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isCloudStorageAvailable = (webApp: any): boolean => {
    if (!webApp) return false;
    const version = Number.parseFloat(webApp.version || '0');
    return version >= 6.9 && !!webApp.CloudStorage;
};

const isThemeMode = (value: unknown): value is ThemeMode => {
    return value === 'light' || value === 'dark';
};

const isThemeSource = (value: unknown): value is ThemeSource => {
    return value === 'manual' || value === 'auto';
};

const readCookieValue = (key: string): string | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    const match = document.cookie.match(new RegExp(`(?:^|; )${key}=([^;]*)`));
    if (!match?.[1]) {
        return null;
    }

    return decodeURIComponent(match[1]);
};

const readThemeCookie = (): ThemeMode | null => {
    const cookieValue = readCookieValue(THEME_COOKIE_KEY);
    return isThemeMode(cookieValue) ? cookieValue : null;
};

const readThemeSourceCookie = (): ThemeSource | null => {
    const cookieValue = readCookieValue(THEME_SOURCE_COOKIE_KEY);
    return isThemeSource(cookieValue) ? cookieValue : null;
};

const writeThemeCookie = (theme: ThemeMode) => {
    if (typeof window === 'undefined') {
        return;
    }

    document.cookie = `${THEME_COOKIE_KEY}=${encodeURIComponent(theme)}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
};

const writeThemeSourceCookie = (source: ThemeSource) => {
    if (typeof window === 'undefined') {
        return;
    }

    document.cookie = `${THEME_SOURCE_COOKIE_KEY}=${encodeURIComponent(source)}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
};

const readThemeLocalStorage = (): ThemeMode | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (isThemeMode(saved)) {
            return saved;
        }
    } catch {
        // Ignore localStorage access errors.
    }

    return null;
};

const readThemeSourceLocalStorage = (): ThemeSource | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        const saved = window.localStorage.getItem(THEME_SOURCE_STORAGE_KEY);
        if (isThemeSource(saved)) {
            return saved;
        }
    } catch {
        // Ignore localStorage access errors.
    }

    return null;
};

const writeThemeLocalStorage = (theme: ThemeMode) => {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
        // Ignore localStorage write errors.
    }
};

const writeThemeSourceLocalStorage = (source: ThemeSource) => {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.localStorage.setItem(THEME_SOURCE_STORAGE_KEY, source);
    } catch {
        // Ignore localStorage write errors.
    }
};

const syncThemeToBrowserStorage = (theme: ThemeMode, source: ThemeSource) => {
    writeThemeLocalStorage(theme);
    writeThemeSourceLocalStorage(source);
    writeThemeCookie(theme);
    writeThemeSourceCookie(source);
};

const readStoredThemePreference = (): { theme: ThemeMode | null; source: ThemeSource | null } => {
    const localTheme = readThemeLocalStorage();
    const cookieTheme = readThemeCookie();
    const localSource = readThemeSourceLocalStorage();
    const cookieSource = readThemeSourceCookie();

    return {
        theme: localTheme ?? cookieTheme,
        source: localSource ?? cookieSource,
    };
};

const normalizeThemeSource = (
    theme: ThemeMode | null,
    source: ThemeSource | null,
): ThemeSource | null => {
    if (!theme) {
        return null;
    }

    return source ?? 'manual';
};

const getThemePalette = (theme: ThemeMode) => {
    if (theme === 'light') {
        return {
            bg: '#f5f8fd',
            secondary: '#ffffff',
            text: '#0f172a',
        };
    }

    return {
        bg: '#121212',
        secondary: '#1E1E1E',
        text: '#ffffff',
    };
};

const getSystemTheme = (fallback: ThemeMode = DEFAULT_THEME): ThemeMode => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return fallback;
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getTelegramTheme = (webApp: any): ThemeMode | null => {
    if (!webApp) {
        return null;
    }

    return isThemeMode(webApp.colorScheme) ? webApp.colorScheme : null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getAutoTheme = (webApp: any, fallback: ThemeMode = DEFAULT_THEME): ThemeMode => {
    return getTelegramTheme(webApp) ?? getSystemTheme(fallback);
};

const applyTheme = (theme: ThemeMode) => {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    const palette = getThemePalette(theme);

    root.setAttribute('data-theme', theme);
    root.style.setProperty('color-scheme', theme);
    root.style.setProperty('background-color', palette.bg);

    if (document.body) {
        document.body.style.backgroundColor = palette.bg;
    }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const applyTelegramChromeTheme = (webApp: any, theme: ThemeMode) => {
    if (!webApp || typeof document === 'undefined') {
        return;
    }

    const palette = getThemePalette(theme);

    document.documentElement.style.setProperty('--tg-theme-bg-color', palette.bg);
    document.documentElement.style.setProperty('--tg-theme-secondary-bg-color', palette.secondary);
    document.documentElement.style.setProperty('--tg-theme-text-color', palette.text);

    try {
        webApp.setHeaderColor?.(palette.bg);
    } catch {
        // Ignore unsupported Telegram API calls.
    }

    try {
        webApp.setBackgroundColor?.(palette.bg);
    } catch {
        // Ignore unsupported Telegram API calls.
    }

    try {
        webApp.setBottomBarColor?.(palette.secondary);
    } catch {
        // Ignore unsupported Telegram API calls.
    }
};

const resolveInitialClientTheme = (initialTheme: ThemeMode): ThemeMode => {
    if (typeof document !== 'undefined') {
        const attrTheme = document.documentElement.getAttribute('data-theme');
        if (isThemeMode(attrTheme)) {
            return attrTheme;
        }
    }

    const storedPreference = readStoredThemePreference();
    const normalizedSource = normalizeThemeSource(storedPreference.theme, storedPreference.source);

    if (storedPreference.theme && normalizedSource === 'manual') {
        return storedPreference.theme;
    }

    if (storedPreference.theme && normalizedSource === 'auto') {
        return getSystemTheme(storedPreference.theme);
    }

    return getSystemTheme(initialTheme);
};

const resolveInitialClientThemeSource = (initialSource: ThemeSource): ThemeSource => {
    const storedPreference = readStoredThemePreference();
    const normalizedSource = normalizeThemeSource(storedPreference.theme, storedPreference.source);
    return normalizedSource ?? initialSource;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const syncThemeToCloudStorage = (webApp: any, theme: ThemeMode, source: ThemeSource) => {
    if (!isCloudStorageAvailable(webApp)) {
        return;
    }

    try {
        webApp.CloudStorage.setItem(THEME_STORAGE_KEY, theme);
        webApp.CloudStorage.setItem(THEME_SOURCE_STORAGE_KEY, source);
    } catch {
        // Ignore CloudStorage write errors.
    }
};

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider = ({
    children,
    initialTheme = DEFAULT_THEME,
    initialThemeSource = DEFAULT_THEME_SOURCE,
}: {
    children: React.ReactNode;
    initialTheme?: ThemeMode;
    initialThemeSource?: ThemeSource;
}) => {
    const { webApp } = useTelegram();
    const [theme, setThemeState] = useState<ThemeMode>(() => resolveInitialClientTheme(initialTheme));
    const [themeSource, setThemeSourceState] = useState<ThemeSource>(
        () => resolveInitialClientThemeSource(initialThemeSource),
    );
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const browserPreference = readStoredThemePreference();

        const finishWithTheme = (nextTheme: ThemeMode, nextSource: ThemeSource) => {
            if (cancelled) return;
            setThemeState(nextTheme);
            setThemeSourceState(nextSource);
            syncThemeToBrowserStorage(nextTheme, nextSource);
            syncThemeToCloudStorage(webApp, nextTheme, nextSource);
            applyTheme(nextTheme);
            applyTelegramChromeTheme(webApp, nextTheme);
            setIsLoading(false);
        };

        const finishWithAutoTheme = (fallbackTheme: ThemeMode = initialTheme) => {
            const nextTheme = getAutoTheme(webApp, fallbackTheme);
            finishWithTheme(nextTheme, 'auto');
        };

        const fallbackToBrowserPreference = () => {
            const normalizedSource = normalizeThemeSource(browserPreference.theme, browserPreference.source);

            if (browserPreference.theme && normalizedSource === 'manual') {
                finishWithTheme(browserPreference.theme, normalizedSource);
                return;
            }

            finishWithAutoTheme(browserPreference.theme ?? initialTheme);
        };

        if (!isCloudStorageAvailable(webApp)) {
            fallbackToBrowserPreference();
            return () => {
                cancelled = true;
            };
        }

        try {
            webApp!.CloudStorage.getItems(
                [THEME_STORAGE_KEY, THEME_SOURCE_STORAGE_KEY],
                (error: Error | null, values?: Record<string, string>) => {
                    if (cancelled) return;

                    const cloudTheme = !error && isThemeMode(values?.[THEME_STORAGE_KEY])
                        ? values?.[THEME_STORAGE_KEY]
                        : null;
                    const cloudSource = !error && isThemeSource(values?.[THEME_SOURCE_STORAGE_KEY])
                        ? values?.[THEME_SOURCE_STORAGE_KEY]
                        : null;
                    const normalizedCloudSource = normalizeThemeSource(cloudTheme, cloudSource);

                    if (cloudTheme && normalizedCloudSource === 'manual') {
                        finishWithTheme(cloudTheme, normalizedCloudSource);
                        return;
                    }

                    if (cloudTheme && normalizedCloudSource === 'auto') {
                        finishWithAutoTheme(cloudTheme);
                        return;
                    }

                    fallbackToBrowserPreference();
                },
            );
        } catch {
            fallbackToBrowserPreference();
        }

        return () => {
            cancelled = true;
        };
    }, [initialTheme, webApp]);

    useEffect(() => {
        if (themeSource !== 'auto') {
            return;
        }

        const applyAutoResolvedTheme = () => {
            const autoTheme = getAutoTheme(webApp, theme);
            if (autoTheme === theme) {
                syncThemeToBrowserStorage(theme, 'auto');
                syncThemeToCloudStorage(webApp, theme, 'auto');
                return;
            }

            setThemeState(autoTheme);
            setThemeSourceState('auto');
            syncThemeToBrowserStorage(autoTheme, 'auto');
            syncThemeToCloudStorage(webApp, autoTheme, 'auto');
            applyTheme(autoTheme);
            applyTelegramChromeTheme(webApp, autoTheme);
        };

        applyAutoResolvedTheme();

        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return;
        }

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const mediaQueryHandler = () => {
            applyAutoResolvedTheme();
        };

        mediaQuery.addEventListener('change', mediaQueryHandler);

        let telegramThemeHandler: (() => void) | null = null;
        if (typeof webApp?.onEvent === 'function') {
            telegramThemeHandler = () => {
                applyAutoResolvedTheme();
            };
            webApp.onEvent('themeChanged', telegramThemeHandler as (...args: unknown[]) => void);
        }

        return () => {
            mediaQuery.removeEventListener('change', mediaQueryHandler);

            if (telegramThemeHandler && typeof webApp?.offEvent === 'function') {
                webApp.offEvent('themeChanged', telegramThemeHandler as (...args: unknown[]) => void);
            }
        };
    }, [theme, themeSource, webApp]);

    useEffect(() => {
        applyTheme(theme);
        applyTelegramChromeTheme(webApp, theme);
    }, [theme, webApp]);

    const setTheme = useCallback((nextTheme: ThemeMode) => {
        const nextSource: ThemeSource = 'manual';

        setThemeState(nextTheme);
        setThemeSourceState(nextSource);
        applyTheme(nextTheme);
        applyTelegramChromeTheme(webApp, nextTheme);
        syncThemeToBrowserStorage(nextTheme, nextSource);
        syncThemeToCloudStorage(webApp, nextTheme, nextSource);
        setIsLoading(false);
    }, [webApp]);

    return (
        <ThemeContext.Provider value={{ theme, setTheme, isLoading }}>
            {children}
        </ThemeContext.Provider>
    );
};
