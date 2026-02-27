'use client';

import React from 'react';
import { useLanguage } from '@/lib/context/LanguageContext';
import { LanguageSelector } from '@/components/features/LanguageSelector';
import styles from './Header.module.css';

export const Header = () => {
    const { t } = useLanguage();

    return (
        <header className={styles.header}>
            <h1 className={styles.logo}>{t('app_title')}</h1>
            <LanguageSelector />
        </header>
    );
};
