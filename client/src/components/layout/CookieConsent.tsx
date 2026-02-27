'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/lib/context/LanguageContext';
import { Cookie } from 'lucide-react';
import styles from './CookieConsent.module.css';

export const CookieConsent = () => {
    const { t } = useLanguage();
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Check if user has already accepted cookies
        const accepted = localStorage.getItem('cookie_consent');
        if (!accepted) {
            setTimeout(() => setIsVisible(true), 1000); // Delay for better UX
        }
    }, []);

    const handleAccept = () => {
        localStorage.setItem('cookie_consent', 'true');
        setIsVisible(false);
    };

    if (!isVisible) return null;

    return (
        <div className={styles.banner}>
            <div className={styles.content}>
                <div className={styles.iconWrapper}>
                    <Cookie size={24} className={styles.icon} />
                </div>
                <div className={styles.text}>
                    <h4 className={styles.title}>{t('cookie_title')}</h4>
                    <p className={styles.description}>{t('cookie_text')}</p>
                </div>
            </div>
            <div className={styles.actions}>
                <Button onClick={handleAccept} size="sm" variant="primary">
                    {t('cookie_accept')}
                </Button>
            </div>
        </div>
    );
};
