'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { IoLanguage, IoSparkles, IoMoon, IoNotifications, IoDiamond } from 'react-icons/io5';

import { SettingActionItem } from '@/components/ui/SettingActionItem';
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
                    <SettingActionItem
                        mode="select"
                        icon={<IoLanguage size={22} color="white" />}
                        iconBackground="linear-gradient(135deg, #3b82f6, #2563eb)"
                        label={t('language') || 'Language'}
                        value={(
                            <>
                                <span className={styles.flag}>{currentLang.flag}</span>
                                <span>{currentLang.name}</span>
                            </>
                        )}
                        open={langDropdownOpen}
                        onToggleOpen={() => {
                            haptic.impact('light');
                            setLangDropdownOpen((prev) => !prev);
                        }}
                        options={languages.map((lang) => ({
                            key: lang.code,
                            active: locale === lang.code,
                            onSelect: () => handleLanguageChange(lang.code),
                            label: (
                                <>
                                    <span className={styles.flag}>{lang.flag}</span>
                                    <span>{lang.name}</span>
                                </>
                            ),
                        }))}
                    />

                    <SettingActionItem
                        mode="toggle"
                        icon={<IoSparkles size={22} color="white" />}
                        iconBackground="linear-gradient(135deg, #f59e0b, #f97316)"
                        label={t('enable_animations') || 'Enable animations'}
                        checked={animationsEnabled}
                        onCheckedChange={() => {
                            void toggleAnimations();
                        }}
                        ariaLabel={t('enable_animations') || 'Enable animations'}
                    />

                    <SettingActionItem
                        mode="toggle"
                        icon={<IoMoon size={22} color="white" />}
                        iconBackground="linear-gradient(135deg, #6366f1, #3b82f6)"
                        label={t('dark_mode') || 'Dark mode'}
                        checked={darkModeEnabled}
                        onCheckedChange={() => {
                            void toggleDarkMode();
                        }}
                        ariaLabel={t('dark_mode') || 'Dark mode'}
                    />

                    <SettingActionItem
                        mode="toggle"
                        icon={<IoNotifications size={22} color="white" />}
                        iconBackground="linear-gradient(135deg, #22c55e, #16a34a)"
                        label={t('notifications_all') || 'All notifications'}
                        checked={notificationsEnabled}
                        onCheckedChange={() => {
                            void toggleAllNotifications();
                        }}
                        ariaLabel={t('notifications_all') || 'All notifications'}
                        disabled={notificationsLoading || notificationsSaving}
                        controlMuted={!canManageNotifications}
                        afterControl={(
                            <button
                                type="button"
                                className={`${styles.expandButton} ${notificationsExpanded ? styles.expanded : ''}`}
                                onClick={() => {
                                    haptic.selection();
                                    setNotificationsExpanded(!notificationsExpanded);
                                }}
                                aria-label={t('notifications') || 'Notifications'}
                            >
                                <ChevronDown size={18} />
                            </button>
                        )}
                    />

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
                                            type="button"
                                            className={styles.permissionPrimary}
                                            onClick={handleRequestWriteAccess}
                                            disabled={isRequestingAccess}
                                        >
                                            {isRequestingAccess
                                                ? (t('connecting') || 'Connecting...')
                                                : (t('allow_bot_messages') || 'Allow bot messages')}
                                        </button>

                                        <button
                                            type="button"
                                            className={styles.permissionGhost}
                                            onClick={handleOpenBot}
                                        >
                                            {t('open_bot_start') || 'Open bot and /start'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {!notificationsLoading && canManageNotifications && (
                                <SettingActionItem
                                    mode="toggle"
                                    icon={<IoDiamond size={22} color="white" />}
                                    iconBackground="linear-gradient(135deg, #0ea5e9, #0284c7)"
                                    label={t('notifications_nft_received') || 'NFT received'}
                                    checked={nftReceivedEnabled}
                                    onCheckedChange={() => {
                                        void toggleNftNotifications();
                                    }}
                                    ariaLabel={t('notifications_nft_received') || 'NFT received'}
                                    disabled={!notificationsEnabled || notificationsSaving}
                                />
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
