'use client';

import React, { useState, useEffect } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { IoSparkles, IoMoon } from 'react-icons/io5';
import { useTelegram } from '@/lib/context/TelegramContext';
import { useLanguage, Locale } from '@/lib/context/LanguageContext';
import { useAnimations } from '@/lib/context/AnimationContext';
import { useTheme } from '@/lib/context/ThemeContext';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';
import styles from './SettingsDrawer.module.css';

interface SettingsDrawerProps {
    isOpen: boolean;
    onClose: () => void;
}

const languages: { code: Locale; name: string; flag: string }[] = [
    { code: 'uz', name: "O'zbekcha", flag: '🇺🇿' },
    { code: 'ru', name: 'Русский', flag: '🇷🇺' },
    { code: 'en', name: 'English', flag: '🇺🇸' },
];

export const SettingsDrawer = ({ isOpen, onClose }: SettingsDrawerProps) => {
    const { haptic } = useTelegram();
    const { locale, setLocale, t } = useLanguage();
    const { animationsEnabled, setAnimationsEnabled } = useAnimations();
    const { theme, setTheme } = useTheme();
    const [visible, setVisible] = useState(false);
    const [langDropdownOpen, setLangDropdownOpen] = useState(false);

    useBodyScrollLock(isOpen && visible);

    useEffect(() => {
        if (isOpen) {
            queueMicrotask(() => setVisible(true));
        }
    }, [isOpen]);

    const handleClose = () => {
        haptic.impact('light');
        setLangDropdownOpen(false);
        setVisible(false);
        setTimeout(onClose, 300);
    };

    const handleLanguageChange = (newLocale: Locale) => {
        if (newLocale !== locale) {
            haptic.impact('medium');
            setLocale(newLocale);
        }
        setLangDropdownOpen(false);
    };

    const toggleAnimations = () => {
        haptic.impact('medium');
        setAnimationsEnabled(!animationsEnabled);
    };

    const lightThemeEnabled = theme === 'light';

    const toggleTheme = () => {
        haptic.impact('medium');
        setTheme(lightThemeEnabled ? 'dark' : 'light');
    };

    const currentLang = languages.find(l => l.code === locale) || languages[2];

    if (!isOpen && !visible) return null;

    return (
        <div
            className={`${styles.overlay} ${visible && isOpen ? styles.visible : ''}`}
            onClick={handleClose}
        >
            <div
                className={`${styles.drawer} ${visible && isOpen ? styles.open : ''}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className={styles.handle}></div>

                <div className={styles.header}>
                    <h3>{t('settings') || 'Settings'}</h3>
                    <button className={styles.closeBtn} onClick={handleClose}>
                        <X size={20} />
                    </button>
                </div>

                {/* Language Selector */}
                <div className={styles.section}>
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

                {/* Animation Toggle */}
                <div className={styles.section}>
                    <div className={styles.toggleRow}>
                        <div className={styles.toggleLeft}>
                            <div className={styles.toggleIconBox}>
                                <IoSparkles size={18} />
                            </div>
                            <span className={styles.toggleLabel}>
                                {t('enable_animations') || 'Enable animations'}
                            </span>
                        </div>
                        <button
                            className={`${styles.toggle} ${animationsEnabled ? styles.toggleOn : ''}`}
                            onClick={toggleAnimations}
                        >
                            <div className={styles.toggleThumb}></div>
                        </button>
                    </div>
                </div>

                {/* Theme Toggle */}
                <div className={styles.section}>
                    <div className={styles.toggleRow}>
                        <div className={styles.toggleLeft}>
                            <div className={`${styles.toggleIconBox} ${styles.themeIconBox}`}>
                                <IoMoon size={18} />
                            </div>
                            <span className={styles.toggleLabel}>
                                {t('theme') || 'Theme'}: {lightThemeEnabled ? (t('light_mode') || 'Light mode') : (t('dark_mode') || 'Dark mode')}
                            </span>
                        </div>
                        <button
                            className={`${styles.toggle} ${lightThemeEnabled ? styles.toggleOn : ''}`}
                            onClick={toggleTheme}
                            aria-label={t('theme') || 'Theme'}
                        >
                            <div className={styles.toggleThumb}></div>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
