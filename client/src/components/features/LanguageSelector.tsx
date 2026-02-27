'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useLanguage } from '@/lib/context/LanguageContext';
import { ChevronDown, Globe } from 'lucide-react';
import styles from './LanguageSelector.module.css';

const LANGUAGES = [
    { code: 'en', label: 'English', flag: '🇬🇧' },
    { code: 'ru', label: 'Русский', flag: '🇷🇺' },
    { code: 'uz', label: 'Oʻzbek', flag: '🇺🇿' },
] as const;

export const LanguageSelector = () => {
    const { locale, setLocale } = useLanguage();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const currentLang = LANGUAGES.find(l => l.code === locale) || LANGUAGES[0];

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (code: typeof LANGUAGES[number]['code']) => {
        setLocale(code);
        setIsOpen(false);
    };

    return (
        <div className={styles.container} ref={containerRef}>
            <button
                className={`${styles.trigger} ${isOpen ? styles.active : ''}`}
                onClick={() => setIsOpen(!isOpen)}
                aria-label="Select Language"
            >
                <span className={styles.flag}>{currentLang.flag}</span>
                <span className={styles.code}>{currentLang.code.toUpperCase()}</span>
                <ChevronDown
                    size={14}
                    className={`${styles.chevron} ${isOpen ? styles.rotate : ''}`}
                />
            </button>

            <div className={`${styles.dropdown} ${isOpen ? styles.open : ''}`}>
                {LANGUAGES.map((lang) => (
                    <button
                        key={lang.code}
                        className={`${styles.option} ${locale === lang.code ? styles.selected : ''}`}
                        onClick={() => handleSelect(lang.code)}
                    >
                        <span className={styles.flag}>{lang.flag}</span>
                        <span className={styles.label}>{lang.label}</span>
                        {locale === lang.code && <div className={styles.dot} />}
                    </button>
                ))}
            </div>
        </div>
    );
};
