'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useTelegram } from './TelegramContext';

const THEME_STORAGE_KEY = 'app_theme_mode';
const DEFAULT_THEME: ThemeMode = 'light';

export type ThemeMode = 'dark' | 'light';

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

const getDefaultTheme = (): ThemeMode => {
    if (typeof window === 'undefined') {
        return DEFAULT_THEME;
    }

    try {
        const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (isThemeMode(saved)) {
            return saved;
        }
    } catch {
        // Ignore localStorage access errors.
    }

    return DEFAULT_THEME;
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

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
    const { webApp } = useTelegram();
    const [theme, setThemeState] = useState<ThemeMode>(DEFAULT_THEME);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const finishWithTheme = (nextTheme: ThemeMode) => {
            if (cancelled) return;
            setThemeState(nextTheme);
            applyTheme(nextTheme);
            applyTelegramChromeTheme(webApp, nextTheme);
            setIsLoading(false);
        };

        if (!isCloudStorageAvailable(webApp)) {
            finishWithTheme(getDefaultTheme());
            return () => {
                cancelled = true;
            };
        }

        try {
            webApp!.CloudStorage.getItem(THEME_STORAGE_KEY, (error: Error | null, value?: string) => {
                if (cancelled) return;

                if (!error && isThemeMode(value)) {
                    finishWithTheme(value);
                    return;
                }

                finishWithTheme(getDefaultTheme());
            });
        } catch {
            finishWithTheme(getDefaultTheme());
        }

        return () => {
            cancelled = true;
        };
    }, [webApp]);

    useEffect(() => {
        applyTheme(theme);
        applyTelegramChromeTheme(webApp, theme);
    }, [theme, webApp]);

    const setTheme = useCallback((nextTheme: ThemeMode) => {
        setThemeState(nextTheme);
        applyTheme(nextTheme);
        applyTelegramChromeTheme(webApp, nextTheme);

        try {
            window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        } catch {
            // Ignore localStorage write errors.
        }

        if (isCloudStorageAvailable(webApp)) {
            try {
                webApp!.CloudStorage.setItem(THEME_STORAGE_KEY, nextTheme);
            } catch {
                // Ignore CloudStorage write errors.
            }
        }
    }, [webApp]);

    return (
        <ThemeContext.Provider value={{ theme, setTheme, isLoading }}>
            {children}
        </ThemeContext.Provider>
    );
};
