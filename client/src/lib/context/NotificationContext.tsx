'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useTelegram } from './TelegramContext';

export type WriteAccessStatus = 'unknown' | 'allowed' | 'denied' | 'blocked';

export interface NotificationPreferences {
    telegramId: string;
    writeAccessStatus: WriteAccessStatus;
    hasWriteAccess: boolean;
    botBlocked: boolean;
    botStarted: boolean;
    canManageNotifications: boolean;
    notificationsEnabled: boolean;
    types: {
        nftReceived: boolean;
    };
    botStartUrl: string;
    updatedAt?: string;
}

interface NotificationContextType {
    preferences: NotificationPreferences | null;
    isLoading: boolean;
    isSaving: boolean;
    isRequestingAccess: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    setNotificationsEnabled: (enabled: boolean) => Promise<boolean>;
    setNftReceivedEnabled: (enabled: boolean) => Promise<boolean>;
    requestWriteAccess: () => Promise<boolean>;
    openBotStart: () => void;
}

const BOT_START_FALLBACK_URL = 'https://t.me';

function isWriteAccessRequiredError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    return error.message.toLowerCase().includes('write_access_required');
}

const NotificationContext = createContext<NotificationContextType>({
    preferences: null,
    isLoading: false,
    isSaving: false,
    isRequestingAccess: false,
    error: null,
    refresh: async () => { },
    setNotificationsEnabled: async () => false,
    setNftReceivedEnabled: async () => false,
    requestWriteAccess: async () => false,
    openBotStart: () => { },
});

export const useNotifications = () => useContext(NotificationContext);

export const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
    const { ready, isAuthenticated, authUser, webApp } = useTelegram();

    const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isRequestingAccess, setIsRequestingAccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!isAuthenticated || !authUser) {
            setPreferences(null);
            setIsLoading(false);
            setError(null);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const response = await api.notifications.getPreferences();
            setPreferences(response.preferences || null);
        } catch (refreshError) {
            setError(refreshError instanceof Error ? refreshError.message : 'Failed to load notification settings');
            setPreferences(null);
        } finally {
            setIsLoading(false);
        }
    }, [authUser, isAuthenticated]);

    useEffect(() => {
        if (!ready) {
            return;
        }

        void refresh();
    }, [ready, refresh]);

    const setNotificationsEnabled = useCallback(async (enabled: boolean) => {
        if (!isAuthenticated || !authUser) {
            return false;
        }

        setIsSaving(true);
        setError(null);

        try {
            const response = await api.notifications.updatePreferences({
                notificationsEnabled: enabled,
                nftReceivedEnabled: enabled ? undefined : false,
            });
            setPreferences(response.preferences || null);
            return true;
        } catch (updateError) {
            if (isWriteAccessRequiredError(updateError)) {
                setError(null);
            } else {
                setError(updateError instanceof Error ? updateError.message : 'Failed to update notification settings');
            }

            await refresh();
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [authUser, isAuthenticated, refresh]);

    const setNftReceivedEnabled = useCallback(async (enabled: boolean) => {
        if (!isAuthenticated || !authUser) {
            return false;
        }

        setIsSaving(true);
        setError(null);

        try {
            const response = await api.notifications.updatePreferences({
                nftReceivedEnabled: enabled,
            });
            setPreferences(response.preferences || null);
            return true;
        } catch (updateError) {
            if (isWriteAccessRequiredError(updateError)) {
                setError(null);
            } else {
                setError(updateError instanceof Error ? updateError.message : 'Failed to update notification settings');
            }

            await refresh();
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [authUser, isAuthenticated, refresh]);

    const requestWriteAccess = useCallback(async () => {
        if (!isAuthenticated || !authUser) {
            return false;
        }

        if (!webApp || typeof webApp.requestWriteAccess !== 'function') {
            setError('requestWriteAccess is not available in this Telegram client');
            return false;
        }

        setIsRequestingAccess(true);
        setError(null);

        try {
            const isAllowed = await new Promise<boolean>((resolve) => {
                let settled = false;
                const timeoutId = window.setTimeout(() => {
                    if (!settled) {
                        settled = true;
                        resolve(false);
                    }
                }, 4500);

                const finish = (allowed: boolean) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    window.clearTimeout(timeoutId);
                    resolve(allowed);
                };

                try {
                    webApp.requestWriteAccess((allowed) => {
                        finish(Boolean(allowed));
                    });
                } catch {
                    finish(false);
                }
            });

            const response = await api.notifications.updateWriteAccess({
                status: isAllowed ? 'allowed' : 'denied',
            });

            setPreferences(response.preferences || null);

            if (!isAllowed) {
                setError('Write access was not granted');
            }

            return isAllowed;
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : 'Failed to request write access');
            return false;
        } finally {
            setIsRequestingAccess(false);
        }
    }, [authUser, isAuthenticated, webApp]);

    const openBotStart = useCallback(() => {
        const botUrl = preferences?.botStartUrl || BOT_START_FALLBACK_URL;

        try {
            if (webApp && typeof webApp.openTelegramLink === 'function') {
                webApp.openTelegramLink(botUrl);
                return;
            }
        } catch {
            // fallback below
        }

        if (typeof window !== 'undefined') {
            window.open(botUrl, '_blank', 'noopener,noreferrer');
        }
    }, [preferences, webApp]);

    const value = useMemo<NotificationContextType>(() => ({
        preferences,
        isLoading,
        isSaving,
        isRequestingAccess,
        error,
        refresh,
        setNotificationsEnabled,
        setNftReceivedEnabled,
        requestWriteAccess,
        openBotStart,
    }), [
        error,
        isLoading,
        isRequestingAccess,
        isSaving,
        openBotStart,
        preferences,
        refresh,
        requestWriteAccess,
        setNftReceivedEnabled,
        setNotificationsEnabled,
    ]);

    return (
        <NotificationContext.Provider value={value}>
            {children}
        </NotificationContext.Provider>
    );
};
