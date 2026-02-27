'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { getTelegramWebApp, IWebApp, IWebAppInsets } from '@/lib/utils/telegram';
import { api } from '@/lib/api';
import { AuthUser, clearAuthSession, getAuthToken, getAuthUser, setAuthToken, setAuthUser as setStoredAuthUser } from '@/lib/auth';

const USER_CACHE_KEY = 'user_profile_cache';
const FULLSCREEN_RETRY_DELAY_MS = 450;
const LAYOUT_EVENTS = ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged'] as const;
const MAX_VISUAL_BOTTOM_SAFE_INSET_PX = 64;
const ANDROID_BOTTOM_NAV_ADJUST_PX = 8;

// Helper to check if CloudStorage is available (requires TG WebApp 6.9+)
const isCloudStorageAvailable = (app: IWebApp | null): boolean => {
    if (!app) return false;
    // CloudStorage requires version 6.9 or higher
    const version = Number.parseFloat(app.version || '0');
    return version >= 6.9 && !!app.CloudStorage;
};

const toPxNumber = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return 0;
};

const getInsetValue = (insets: Partial<IWebAppInsets> | undefined, side: keyof IWebAppInsets): number => {
    return toPxNumber(insets?.[side]);
};

const setCssVar = (name: string, value: string) => {
    document.documentElement.style.setProperty(name, value);
};

const getVisualViewportInsets = (): IWebAppInsets => {
    const viewport = window.visualViewport;

    if (!viewport) {
        return { top: 0, right: 0, bottom: 0, left: 0 };
    }

    const top = Math.max(0, viewport.offsetTop);
    const left = Math.max(0, viewport.offsetLeft);
    const bottom = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    const right = Math.max(0, window.innerWidth - viewport.width - viewport.offsetLeft);

    return { top, right, bottom, left };
};

const getDerivedTopInset = (app: IWebApp | null, bottomInset: number): number => {
    const appViewportHeight = toPxNumber(app?.viewportHeight);

    if (!appViewportHeight) {
        return 0;
    }

    const totalInsets = Math.max(0, window.innerHeight - appViewportHeight);

    return Math.max(0, totalInsets - bottomInset);
};

const applyViewportVars = (app: IWebApp | null) => {
    const viewportHeight = Math.max(
        0,
        toPxNumber(app?.viewportHeight)
        || window.innerHeight
        || document.documentElement.clientHeight
        || 0
    );

    const viewportStableHeight = Math.max(
        viewportHeight,
        toPxNumber(app?.viewportStableHeight) || viewportHeight
    );

    setCssVar('--app-viewport-height', `${viewportHeight}px`);
    setCssVar('--app-viewport-stable-height', `${viewportStableHeight}px`);
};

const applySafeAreaVars = (app: IWebApp | null) => {
    const safeInsets = app?.safeAreaInset;
    const contentSafeInsets = app?.contentSafeAreaInset;

    const safeTop = getInsetValue(safeInsets, 'top');
    const safeRight = getInsetValue(safeInsets, 'right');
    const safeBottom = getInsetValue(safeInsets, 'bottom');
    const safeLeft = getInsetValue(safeInsets, 'left');

    const contentTop = getInsetValue(contentSafeInsets, 'top');
    const contentRight = getInsetValue(contentSafeInsets, 'right');
    const contentBottom = getInsetValue(contentSafeInsets, 'bottom');
    const contentLeft = getInsetValue(contentSafeInsets, 'left');

    setCssVar('--tg-safe-area-top', `${safeTop}px`);
    setCssVar('--tg-safe-area-right', `${safeRight}px`);
    setCssVar('--tg-safe-area-bottom', `${safeBottom}px`);
    setCssVar('--tg-safe-area-left', `${safeLeft}px`);

    setCssVar('--tg-content-safe-area-top', `${contentTop}px`);
    setCssVar('--tg-content-safe-area-right', `${contentRight}px`);
    setCssVar('--tg-content-safe-area-bottom', `${contentBottom}px`);
    setCssVar('--tg-content-safe-area-left', `${contentLeft}px`);

    const visualInsets = getVisualViewportInsets();
    const visualBottomSafeInset = Math.min(Math.max(0, visualInsets.bottom), MAX_VISUAL_BOTTOM_SAFE_INSET_PX);
    const bottomUi = Math.max(safeBottom, contentBottom, visualBottomSafeInset);
    const hasTelegramTopInset = safeTop > 0 || contentTop > 0 || visualInsets.top > 0;
    const derivedTopInset = hasTelegramTopInset ? 0 : getDerivedTopInset(app, bottomUi);

    // Telegram can return top inset = 0 while top controls are still visible.
    // Keep a minimum top offset in Telegram sessions to avoid content overlap.
    const platformTopMinimum = app ? (app.platform === 'ios' ? 76 : 66) : 0;
    const needsTelegramOverlayFallback = Boolean(app && !hasTelegramTopInset);
    const overlayTopFallback = needsTelegramOverlayFallback
        ? platformTopMinimum
        : 0;

    // Prioritize Telegram/system insets. If Telegram reports 0 in fullscreen, use a practical fallback for top controls.
    const topUi = Math.max(
        safeTop,
        contentTop,
        visualInsets.top,
        derivedTopInset,
        overlayTopFallback,
        platformTopMinimum
    );
    const rightUi = Math.max(safeRight, contentRight, visualInsets.right);
    const leftUi = Math.max(safeLeft, contentLeft, visualInsets.left);

    const isAndroidLikePlatform = Boolean(app && app.platform !== 'ios');
    const bottomNavInset = Math.max(0, bottomUi - (isAndroidLikePlatform ? ANDROID_BOTTOM_NAV_ADJUST_PX : 0));

    const topUiCss = `max(${topUi}px, env(safe-area-inset-top, 0px))`;
    const rightUiCss = `max(${rightUi}px, env(safe-area-inset-right, 0px))`;
    const bottomUiCss = `max(${bottomUi}px, env(safe-area-inset-bottom, 0px))`;
    const bottomNavCss = `max(${bottomNavInset}px, env(safe-area-inset-bottom, 0px))`;
    const leftUiCss = `max(${leftUi}px, env(safe-area-inset-left, 0px))`;

    setCssVar('--app-safe-top-ui', topUiCss);
    setCssVar('--app-safe-right', rightUiCss);
    setCssVar('--app-safe-bottom-ui', bottomUiCss);
    setCssVar('--app-safe-left', leftUiCss);
    setCssVar('--app-safe-bottom-nav', bottomNavCss);
    setCssVar('--app-safe-top-derived', `${derivedTopInset}px`);

    // Legacy aliases used by some pages/components.
    setCssVar('--safe-area-top', topUiCss);
    setCssVar('--safe-area-right', rightUiCss);
    setCssVar('--safe-area-bottom', bottomUiCss);
    setCssVar('--safe-area-left', leftUiCss);
};

const applyLayoutVars = (app: IWebApp | null) => {
    applyViewportVars(app);
    applySafeAreaVars(app);
};

const requestAppFullscreen = (app: IWebApp) => {
    const tryExpand = () => {
        try {
            app.expand();
        } catch {
            console.log('WebApp expand not available');
        }
    };

    const tryFullscreen = () => {
        if (typeof app.requestFullscreen !== 'function') {
            return;
        }

        try {
            app.requestFullscreen?.();
        } catch {
            console.log('requestFullscreen not available');
        }
    };

    tryExpand();
    tryFullscreen();

    window.setTimeout(() => {
        tryExpand();
        tryFullscreen();
        applyLayoutVars(app);
    }, FULLSCREEN_RETRY_DELAY_MS);
};

interface TelegramContextType {
    webApp: IWebApp | null;
    user: any;
    authUser: AuthUser | null;
    ready: boolean;
    isAuthenticated: boolean;
    // Haptic feedback helpers
    haptic: {
        impact: (style?: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
        success: () => void;
        error: () => void;
        warning: () => void;
        selection: () => void;
    };
}

const noopHaptic = {
    impact: () => { },
    success: () => { },
    error: () => { },
    warning: () => { },
    selection: () => { },
};

const TelegramContext = createContext<TelegramContextType>({
    webApp: null,
    user: null,
    authUser: null,
    ready: false,
    isAuthenticated: false,
    haptic: noopHaptic,
});

export const useTelegram = () => useContext(TelegramContext);

export const TelegramProvider = ({ children }: { children: React.ReactNode }) => {
    const [webApp, setWebApp] = useState<IWebApp | null>(null);
    const [authUser, setAuthUser] = useState<AuthUser | null>(null);
    const [ready, setReady] = useState(false);
    const [authAttempted, setAuthAttempted] = useState(false);

    // Restore persisted auth state from local storage
    useEffect(() => {
        const token = getAuthToken();
        const persistedUser = getAuthUser();

        if (token && persistedUser) {
            setAuthUser(persistedUser);
            return;
        }

        if (token && !persistedUser) {
            clearAuthSession();
        }
    }, []);

    // State for extended user info (including wallet and photo_url)
    const [extendedUser, setExtendedUser] = useState<any>(null);

    // Initialize Telegram WebApp
    useEffect(() => {
        let app: IWebApp | null = null;
        let layoutEventHandler: (() => void) | null = null;
        let themeEventHandler: (() => void) | null = null;
        let layoutRaf = 0;
        const delayedLayoutTimers = new Set<number>();

        const updateLayoutVars = () => {
            applyLayoutVars(app);
        };

        const scheduleLayoutVars = () => {
            if (layoutRaf) {
                return;
            }

            layoutRaf = window.requestAnimationFrame(() => {
                layoutRaf = 0;
                updateLayoutVars();
            });
        };

        const scheduleKeyboardCloseResync = () => {
            scheduleLayoutVars();
            [120, 360, 720].forEach((delay) => {
                const timer = window.setTimeout(() => {
                    delayedLayoutTimers.delete(timer);
                    scheduleLayoutVars();
                }, delay);
                delayedLayoutTimers.add(timer);
            });
        };

        const syncThemeVars = () => {
            if (!app) return;
            document.documentElement.style.setProperty('--tg-theme-bg-color', app.themeParams.bg_color || '#121212');
            document.documentElement.style.setProperty('--tg-theme-text-color', app.themeParams.text_color || '#ffffff');
            document.documentElement.style.setProperty('--tg-theme-button-color', app.themeParams.button_color || '#3390ec');
            document.documentElement.style.setProperty('--tg-theme-button-text-color', app.themeParams.button_text_color || '#ffffff');
            document.documentElement.style.setProperty('--tg-theme-secondary-bg-color', app.themeParams.secondary_bg_color || '#1E1E1E');
        };

        app = getTelegramWebApp();

        if (app) {
            try {
                app.ready();
            } catch {
                console.log('WebApp ready not available');
            }

            requestAppFullscreen(app);

            // Disable swipe-to-close gesture (wrap in try-catch for older versions)
            try {
                if (typeof app.disableVerticalSwipes === 'function') {
                    app.disableVerticalSwipes();
                }
            } catch {
                console.log('disableVerticalSwipes not available');
            }

            // Enable closing confirmation dialog
            try {
                if (typeof app.enableClosingConfirmation === 'function') {
                    app.enableClosingConfirmation();
                }
            } catch {
                console.log('enableClosingConfirmation not available');
            }

            setWebApp(app);
            setReady(true);

            syncThemeVars();
            updateLayoutVars();

            if (typeof app.onEvent === 'function') {
                layoutEventHandler = () => {
                    scheduleLayoutVars();
                };

                LAYOUT_EVENTS.forEach((eventName) => {
                    app?.onEvent?.(eventName, layoutEventHandler as (...args: unknown[]) => void);
                });

                themeEventHandler = () => {
                    syncThemeVars();
                };
                app.onEvent('themeChanged', themeEventHandler);
            }

            // Handle startapp deeplink parameter
            const startParam = app.initDataUnsafe?.start_param;
            if (startParam) {
                let targetPath: string | null = null;
                let redirectKeySuffix: string | null = null;

                if (startParam.startsWith('activate_')) {
                    const token = startParam.replace('activate_', '');
                    targetPath = `/activate/${token}`; // Token is already URL-safe
                    redirectKeySuffix = token.substring(0, 20);
                } else if (startParam === 'profile') {
                    targetPath = '/profile';
                    redirectKeySuffix = 'profile';
                }

                if (targetPath && redirectKeySuffix) {
                    const redirectKey = `startapp_processed_${redirectKeySuffix}`;
                    const alreadyProcessed = sessionStorage.getItem(redirectKey);
                    const alreadyOnPage = window.location.pathname === targetPath
                        || window.location.pathname.startsWith(`${targetPath}/`);

                    if (!alreadyProcessed && !alreadyOnPage) {
                        sessionStorage.setItem(redirectKey, 'true');
                        console.log('🔗 Redirecting via startapp:', targetPath);
                        window.location.replace(targetPath);
                    }
                }
            }

            // Load cached user data from CloudStorage for instant profile display
            // Only works in Telegram WebApp 6.9+, silently skip in older versions or browser
            if (isCloudStorageAvailable(app)) {
                try {
                    app.CloudStorage.getItem(USER_CACHE_KEY, (error, value) => {
                        if (!error && value) {
                            try {
                                const cachedUser = JSON.parse(value);
                                // Only use cache if we don't have extended user yet
                                setExtendedUser((prev: any) => prev || cachedUser);
                                console.log('📦 Loaded cached user profile');
                            } catch {
                                console.warn('Failed to parse cached user data');
                            }
                        }
                    });
                } catch {
                    // CloudStorage not supported in this version, silently ignore
                    console.log('ℹ️ CloudStorage not available, skipping cache load');
                }
            }
        } else {
            // Browser mode - no Telegram WebApp, but still set ready=true
            console.log('ℹ️ Running in browser mode (no Telegram WebApp)');
            updateLayoutVars();
            setReady(true);
        }

        const visualViewport = window.visualViewport;

        window.addEventListener('resize', scheduleLayoutVars);
        window.addEventListener('orientationchange', scheduleLayoutVars);
        window.addEventListener('focusin', scheduleLayoutVars, true);
        window.addEventListener('focusout', scheduleKeyboardCloseResync, true);
        visualViewport?.addEventListener('resize', scheduleLayoutVars);
        visualViewport?.addEventListener('scroll', scheduleLayoutVars);

        return () => {
            window.removeEventListener('resize', scheduleLayoutVars);
            window.removeEventListener('orientationchange', scheduleLayoutVars);
            window.removeEventListener('focusin', scheduleLayoutVars, true);
            window.removeEventListener('focusout', scheduleKeyboardCloseResync, true);
            visualViewport?.removeEventListener('resize', scheduleLayoutVars);
            visualViewport?.removeEventListener('scroll', scheduleLayoutVars);

            if (layoutRaf) {
                window.cancelAnimationFrame(layoutRaf);
                layoutRaf = 0;
            }

            delayedLayoutTimers.forEach((timer) => {
                window.clearTimeout(timer);
            });
            delayedLayoutTimers.clear();

            if (app?.offEvent && layoutEventHandler) {
                LAYOUT_EVENTS.forEach((eventName) => {
                    app?.offEvent?.(eventName, layoutEventHandler as (...args: unknown[]) => void);
                });
            }

            if (app?.offEvent && themeEventHandler) {
                app.offEvent('themeChanged', themeEventHandler);
            }
        };
    }, []);

    // Authenticate with backend and store local JWT when Telegram is ready
    useEffect(() => {
        const authenticateWithJwt = async () => {
            if (!webApp?.initData || authAttempted || authUser) return;

            setAuthAttempted(true);

            try {
                const data = await api.auth.telegram(webApp.initData);

                if (!data?.token || !data?.user?.uid) {
                    throw new Error('Invalid auth response');
                }

                const nextAuthUser: AuthUser = {
                    uid: data.user.uid,
                    telegramId: Number(data.user.telegramId),
                    firstName: data.user.firstName,
                    lastName: data.user.lastName,
                    username: data.user.username,
                };
                setAuthToken(data.token);
                setStoredAuthUser(nextAuthUser);
                setAuthUser(nextAuthUser);

                // Build extended user info with wallet and photo_url
                const userInfo = {
                    ...webApp.initDataUnsafe?.user,
                    id: webApp.initDataUnsafe?.user?.id ?? Number(data.user.telegramId),
                    first_name: webApp.initDataUnsafe?.user?.first_name || data.user.firstName || '',
                    last_name: webApp.initDataUnsafe?.user?.last_name || data.user.lastName || '',
                    username: webApp.initDataUnsafe?.user?.username || data.user.username || '',
                    walletAddress: data.user.walletAddress,
                    walletFriendly: data.user.walletFriendly,
                    photo_url: data.user.photoUrl || webApp.initDataUnsafe?.user?.photo_url,
                };

                setExtendedUser(userInfo);

                // Cache user data to CloudStorage for faster loading on next open
                // Only works in Telegram WebApp 6.9+, silently skip in older versions or browser
                if (isCloudStorageAvailable(webApp)) {
                    try {
                        webApp.CloudStorage.setItem(
                            USER_CACHE_KEY,
                            JSON.stringify(userInfo),
                            (error) => {
                                if (error) {
                                    console.warn('Failed to cache user profile:', error);
                                } else {
                                    console.log('💾 Cached user profile to CloudStorage');
                                }
                            }
                        );
                    } catch {
                        // CloudStorage not supported, silently ignore
                        console.log('ℹ️ CloudStorage not available, skipping cache save');
                    }
                }

                console.log('✅ JWT auth successful');
            } catch (error) {
                clearAuthSession();
                setAuthUser(null);
                console.error('JWT auth error:', error);
            }
        };

        authenticateWithJwt();
    }, [webApp, authAttempted, authUser]);

    // Haptic feedback helpers
    const haptic = React.useMemo(() => ({
        impact: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'medium') => {
            webApp?.HapticFeedback?.impactOccurred(style);
        },
        success: () => {
            webApp?.HapticFeedback?.notificationOccurred('success');
        },
        error: () => {
            webApp?.HapticFeedback?.notificationOccurred('error');
        },
        warning: () => {
            webApp?.HapticFeedback?.notificationOccurred('warning');
        },
        selection: () => {
            webApp?.HapticFeedback?.selectionChanged();
        },
    }), [webApp]);

    const value = {
        webApp,
        user: extendedUser || webApp?.initDataUnsafe?.user,
        authUser,
        ready,
        isAuthenticated: !!authUser,
        haptic,
    };

    return (
        <TelegramContext.Provider value={value}>
            {children}
        </TelegramContext.Provider>
    );
};
