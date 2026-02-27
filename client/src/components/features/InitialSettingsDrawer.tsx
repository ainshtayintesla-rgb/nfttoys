'use client';

import React, { useEffect, useState } from 'react';
import { Bell, ChevronDown, SunMoon } from 'lucide-react';
import { useTelegram } from '@/lib/context/TelegramContext';
import { useLanguage, Locale } from '@/lib/context/LanguageContext';
import { useTheme } from '@/lib/context/ThemeContext';
import { useNotifications } from '@/lib/context/NotificationContext';
import { Button } from '@/components/ui/Button';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';
import styles from './InitialSettingsDrawer.module.css';

const INITIAL_SETTINGS_KEY = 'initial_settings_done';

const languages: { code: Locale; name: string; flag: string }[] = [
    { code: 'uz', name: "O'zbekcha", flag: '🇺🇿' },
    { code: 'ru', name: 'Русский', flag: '🇷🇺' },
    { code: 'en', name: 'English', flag: '🇺🇸' },
];

const isCloudStorageAvailable = (webApp: any): boolean => {
    if (!webApp) return false;
    const version = Number.parseFloat(webApp.version || '0');
    return version >= 6.9 && !!webApp.CloudStorage;
};

const readLocalFlag = (): boolean => {
    try {
        return window.localStorage.getItem(INITIAL_SETTINGS_KEY) === '1';
    } catch {
        return false;
    }
};

const writeLocalFlag = () => {
    try {
        window.localStorage.setItem(INITIAL_SETTINGS_KEY, '1');
    } catch {
        // Ignore localStorage write issues.
    }
};

export const InitialSettingsDrawer = () => {
    const { webApp, ready, haptic } = useTelegram();
    const { locale, setLocale, t } = useLanguage();
    const { theme, setTheme } = useTheme();
    const {
        preferences,
        isLoading: notificationsLoading,
        isSaving: notificationsSaving,
        isRequestingAccess,
        setNotificationsEnabled,
        requestWriteAccess,
        openBotStart,
    } = useNotifications();

    const [isVisible, setIsVisible] = useState(false);
    const [isChecking, setIsChecking] = useState(true);
    const [langDropdownOpen, setLangDropdownOpen] = useState(false);

    const darkModeEnabled = theme === 'dark';

    useBodyScrollLock(!isChecking && isVisible);
    const currentLang = languages.find((lang) => lang.code === locale) || languages[2];

    const canManageNotifications = Boolean(preferences?.canManageNotifications);
    const notificationsEnabled = Boolean(preferences?.notificationsEnabled);

    useEffect(() => {
        if (!ready) {
            return;
        }

        if (!webApp?.initData) {
            setIsVisible(false);
            setIsChecking(false);
            return;
        }

        let cancelled = false;
        const localDone = readLocalFlag();

        if (localDone) {
            setIsVisible(false);
            setIsChecking(false);
            return;
        }

        if (!isCloudStorageAvailable(webApp)) {
            setIsVisible(true);
            setIsChecking(false);
            return;
        }

        try {
            webApp!.CloudStorage.getItem(INITIAL_SETTINGS_KEY, (error: Error | null, value?: string) => {
                if (cancelled) return;
                const cloudDone = !error && value === '1';
                setIsVisible(!cloudDone);
                setIsChecking(false);
            });
        } catch {
            setIsVisible(true);
            setIsChecking(false);
        }

        return () => {
            cancelled = true;
        };
    }, [ready, webApp]);

    const handleLanguageChange = (nextLocale: Locale) => {
        if (nextLocale !== locale) {
            haptic.impact('medium');
            setLocale(nextLocale);
        }
        setLangDropdownOpen(false);
    };

    const toggleDarkMode = () => {
        haptic.impact('medium');
        setTheme(darkModeEnabled ? 'light' : 'dark');
    };

    const toggleAllNotifications = async () => {
        if (notificationsLoading || notificationsSaving) {
            return;
        }

        if (!canManageNotifications) {
            haptic.warning();
            return;
        }

        haptic.impact('medium');
        await setNotificationsEnabled(!notificationsEnabled);
    };

    const handleRequestWriteAccess = async () => {
        haptic.impact('medium');
        const granted = await requestWriteAccess();
        if (granted) {
            haptic.success();
        } else {
            haptic.warning();
        }
    };

    const handleOpenBot = () => {
        haptic.impact('light');
        openBotStart();
    };

    const closeDrawer = () => {
        writeLocalFlag();

        if (isCloudStorageAvailable(webApp)) {
            try {
                webApp!.CloudStorage.setItem(INITIAL_SETTINGS_KEY, '1');
            } catch {
                // Ignore CloudStorage write issues.
            }
        }

        haptic.success();
        setLangDropdownOpen(false);
        setIsVisible(false);
    };

    if (isChecking || !isVisible) {
        return null;
    }

    return (
        <div className={styles.overlay}>
            <div className={styles.drawer}>
                <div className={styles.handle}></div>

                <div className={styles.header}>
                    <h3>{t('settings') || 'Settings'}</h3>
                </div>

                <div className={styles.section}>
                    <div className={styles.sectionTitle}>{t('language') || 'Language'}</div>
                    <div className={styles.selectWrapper}>
                        <button
                            className={styles.select}
                            onClick={() => {
                                haptic.impact('light');
                                setLangDropdownOpen(!langDropdownOpen);
                            }}
                        >
                            <span className={styles.flag}>{currentLang.flag}</span>
                            <span className={styles.selectValue}>{currentLang.name}</span>
                            <ChevronDown
                                size={18}
                                className={`${styles.chevron} ${langDropdownOpen ? styles.rotated : ''}`}
                            />
                        </button>

                        {langDropdownOpen && (
                            <div className={styles.dropdown}>
                                {languages.map((lang) => (
                                    <button
                                        key={lang.code}
                                        className={`${styles.dropdownItem} ${locale === lang.code ? styles.active : ''}`}
                                        onClick={() => handleLanguageChange(lang.code)}
                                    >
                                        <span className={styles.flag}>{lang.flag}</span>
                                        <span>{lang.name}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className={styles.section}>
                    <div className={styles.toggleRow}>
                        <div className={styles.toggleLeft}>
                            <div className={styles.toggleIconBox}>
                                <SunMoon size={18} />
                            </div>
                            <span className={styles.toggleLabel}>{t('dark_mode') || 'Dark mode'}</span>
                        </div>
                        <button
                            className={`${styles.toggle} ${darkModeEnabled ? styles.toggleOn : ''}`}
                            onClick={toggleDarkMode}
                            aria-label={t('dark_mode') || 'Dark mode'}
                        >
                            <div className={styles.toggleThumb}></div>
                        </button>
                    </div>
                </div>

                <div className={styles.section}>
                    <div className={styles.toggleRow}>
                        <div className={styles.toggleLeft}>
                            <div className={`${styles.toggleIconBox} ${styles.notificationsIconBox}`}>
                                <Bell size={18} />
                            </div>
                            <span className={styles.toggleLabel}>{t('notifications_all') || 'All notifications'}</span>
                        </div>
                        <button
                            className={`${styles.toggle} ${notificationsEnabled ? styles.toggleOn : ''} ${(!canManageNotifications || notificationsLoading || notificationsSaving) ? styles.toggleDisabled : ''}`}
                            onClick={toggleAllNotifications}
                            disabled={notificationsLoading || notificationsSaving}
                            aria-label={t('notifications_all') || 'All notifications'}
                        >
                            <div className={styles.toggleThumb}></div>
                        </button>
                    </div>

                    {!notificationsLoading && !canManageNotifications && (
                        <div className={styles.permissionCard}>
                            <p className={styles.permissionHint}>
                                {preferences?.botBlocked
                                    ? (t('notification_blocked_hint') || 'Bot is blocked. Open bot chat and press /start.')
                                    : (t('notification_permission_required') || 'Allow the bot to message you first to enable notifications.')}
                            </p>

                            <div className={styles.permissionActions}>
                                <button
                                    className={styles.permissionPrimary}
                                    onClick={handleRequestWriteAccess}
                                    disabled={isRequestingAccess}
                                >
                                    {isRequestingAccess
                                        ? (t('connecting') || 'Connecting...')
                                        : (t('allow_bot_messages') || 'Allow bot messages')}
                                </button>
                                <button
                                    className={styles.permissionGhost}
                                    onClick={handleOpenBot}
                                >
                                    {t('open_bot_start') || 'Open bot and /start'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <Button variant="primary" fullWidth onClick={closeDrawer}>
                    {t('continue') || 'Continue'}
                </Button>
            </div>
        </div>
    );
};
