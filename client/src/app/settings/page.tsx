'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, ChevronDown, Sparkles, SunMoon } from 'lucide-react';
import { useTelegram } from '@/lib/context/TelegramContext';
import { useLanguage, Locale } from '@/lib/context/LanguageContext';
import { useAnimations } from '@/lib/context/AnimationContext';
import { useTheme } from '@/lib/context/ThemeContext';
import { useNotifications } from '@/lib/context/NotificationContext';
import styles from './page.module.css';

const languages: { code: Locale; name: string; flag: string }[] = [
    { code: 'uz', name: "O'zbekcha", flag: '🇺🇿' },
    { code: 'ru', name: 'Русский', flag: '🇷🇺' },
    { code: 'en', name: 'English', flag: '🇺🇸' },
];

export default function SettingsPage() {
    const router = useRouter();
    const { webApp, haptic } = useTelegram();
    const { locale, setLocale, t } = useLanguage();
    const { animationsEnabled, setAnimationsEnabled } = useAnimations();
    const { theme, setTheme } = useTheme();
    const {
        preferences,
        isLoading: notificationsLoading,
        isSaving: notificationsSaving,
        isRequestingAccess,
        error: notificationsError,
        setNotificationsEnabled,
        setNftReceivedEnabled,
        requestWriteAccess,
        openBotStart,
    } = useNotifications();

    const [langDropdownOpen, setLangDropdownOpen] = useState(false);
    const [notificationsExpanded, setNotificationsExpanded] = useState(false);

    const darkModeEnabled = theme === 'dark';
    const currentLang = languages.find((lang) => lang.code === locale) || languages[2];

    const canManageNotifications = Boolean(preferences?.canManageNotifications);
    const notificationsEnabled = Boolean(preferences?.notificationsEnabled);
    const nftReceivedEnabled = Boolean(preferences?.types?.nftReceived);

    const handleBack = useCallback(() => {
        haptic.impact('light');
        if (window.history.length > 1) {
            router.back();
            return;
        }
        router.push('/profile');
    }, [haptic, router]);

    useEffect(() => {
        const backButton = webApp?.BackButton;
        if (!backButton) {
            return;
        }

        backButton.show();
        backButton.onClick(handleBack);

        return () => {
            backButton.offClick(handleBack);
            backButton.hide();
        };
    }, [webApp, handleBack]);

    useEffect(() => {
        const closeDropdown = () => setLangDropdownOpen(false);
        window.addEventListener('scroll', closeDropdown, true);
        return () => window.removeEventListener('scroll', closeDropdown, true);
    }, []);

    const handleLanguageChange = (nextLocale: Locale) => {
        if (nextLocale !== locale) {
            haptic.impact('medium');
            setLocale(nextLocale);
        }
        setLangDropdownOpen(false);
    };

    const toggleAnimations = () => {
        haptic.impact('medium');
        setAnimationsEnabled(!animationsEnabled);
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
            setNotificationsExpanded(true);
            return;
        }

        haptic.impact('medium');
        const isUpdated = await setNotificationsEnabled(!notificationsEnabled);
        if (!isUpdated) {
            haptic.warning();
            setNotificationsExpanded(true);
        }
    };

    const toggleNftNotifications = async () => {
        if (notificationsLoading || notificationsSaving || !notificationsEnabled || !canManageNotifications) {
            return;
        }

        haptic.impact('light');
        const isUpdated = await setNftReceivedEnabled(!nftReceivedEnabled);
        if (!isUpdated) {
            haptic.warning();
            setNotificationsExpanded(true);
        }
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

    return (
        <div className={styles.container}>
            <main className={styles.main}>
                <header className={styles.header}>
                    <h1>{t('settings') || 'Settings'}</h1>
                </header>

                <div className={styles.settingsList}>
                    <div className={styles.settingRow}>
                        <span className={styles.settingName}>{t('language') || 'Language'}</span>
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

                    <div className={styles.rowDivider}></div>

                    <div className={styles.settingRow}>
                        <div className={styles.toggleLeft}>
                            <div className={styles.toggleIconBox}>
                                <Sparkles size={18} />
                            </div>
                            <span className={styles.toggleLabel}>
                                {t('enable_animations') || 'Enable animations'}
                            </span>
                        </div>
                        <button
                            className={`${styles.toggle} ${animationsEnabled ? styles.toggleOn : ''}`}
                            onClick={toggleAnimations}
                            aria-label={t('enable_animations') || 'Enable animations'}
                        >
                            <div className={styles.toggleThumb}></div>
                        </button>
                    </div>

                    <div className={styles.rowDivider}></div>

                    <div className={styles.settingRow}>
                        <div className={styles.toggleLeft}>
                            <div className={`${styles.toggleIconBox} ${styles.themeIconBox}`}>
                                <SunMoon size={18} />
                            </div>
                            <span className={styles.toggleLabel}>
                                {t('dark_mode') || 'Dark mode'}
                            </span>
                        </div>
                        <button
                            className={`${styles.toggle} ${darkModeEnabled ? styles.toggleOn : ''}`}
                            onClick={toggleDarkMode}
                            aria-label={t('dark_mode') || 'Dark mode'}
                        >
                            <div className={styles.toggleThumb}></div>
                        </button>
                    </div>

                    <div className={styles.rowDivider}></div>

                    <div className={styles.settingRow}>
                        <div className={styles.toggleLeft}>
                            <div className={`${styles.toggleIconBox} ${styles.notificationsIconBox}`}>
                                <Bell size={18} />
                            </div>
                            <span className={styles.toggleLabel}>
                                {t('notifications_all') || 'All notifications'}
                            </span>
                        </div>

                        <div className={styles.notificationControls}>
                            <button
                                className={`${styles.toggle} ${notificationsEnabled ? styles.toggleOn : ''} ${(notificationsLoading || notificationsSaving || !canManageNotifications) ? styles.toggleDisabled : ''}`}
                                onClick={toggleAllNotifications}
                                disabled={notificationsLoading || notificationsSaving}
                                aria-label={t('notifications_all') || 'All notifications'}
                            >
                                <div className={styles.toggleThumb}></div>
                            </button>

                            <button
                                className={`${styles.expandButton} ${notificationsExpanded ? styles.expanded : ''}`}
                                onClick={() => {
                                    haptic.selection();
                                    setNotificationsExpanded(!notificationsExpanded);
                                }}
                                aria-label={t('notifications') || 'Notifications'}
                            >
                                <ChevronDown size={18} />
                            </button>
                        </div>
                    </div>

                    {notificationsExpanded && (
                        <div className={styles.notificationBody}>
                            {notificationsLoading && (
                                <p className={styles.subHint}>{t('connecting') || 'Connecting...'}</p>
                            )}

                            {!notificationsLoading && !canManageNotifications && (
                                <div className={styles.permissionBox}>
                                    <p className={styles.permissionText}>
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

                            {!notificationsLoading && canManageNotifications && (
                                <div className={`${styles.settingRow} ${styles.subToggleRow}`}>
                                    <div className={styles.toggleLeft}>
                                        <div className={`${styles.toggleIconBox} ${styles.subNotificationIconBox}`}>
                                            <Bell size={16} />
                                        </div>
                                        <span className={styles.toggleLabel}>
                                            {t('notifications_nft_received') || 'NFT received'}
                                        </span>
                                    </div>
                                    <button
                                        className={`${styles.toggle} ${nftReceivedEnabled ? styles.toggleOn : ''} ${!notificationsEnabled ? styles.toggleDisabled : ''}`}
                                        onClick={toggleNftNotifications}
                                        disabled={!notificationsEnabled || notificationsSaving}
                                        aria-label={t('notifications_nft_received') || 'NFT received'}
                                    >
                                        <div className={styles.toggleThumb}></div>
                                    </button>
                                </div>
                            )}

                            {notificationsError && (
                                <p className={styles.errorText}>{notificationsError}</p>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
