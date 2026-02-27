'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/lib/context/LanguageContext';
import { useTelegram } from '@/lib/context/TelegramContext';
import { Home, Scan, User } from 'lucide-react';
import styles from './Navigation.module.css';

export const Navigation = () => {
    const pathname = usePathname();
    const { t } = useLanguage();
    const { haptic } = useTelegram();

    const navItems = [
        { href: '/', label: 'home', Icon: Home },
        { href: '/scan', label: 'scan', Icon: Scan },
        { href: '/profile', label: 'profile', Icon: User },
    ];

    if (pathname.startsWith('/scan/')) return null; // Hide nav on scan result page if desired

    const handleNavClick = () => {
        haptic.selection();
    };

    return (
        <nav className={styles.nav}>
            <div className={styles.container}>
                {navItems.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`${styles.item} ${isActive ? styles.active : ''}`}
                            onClick={handleNavClick}
                        >
                            <item.Icon size={24} strokeWidth={isActive ? 2.5 : 2} className={styles.icon} />
                            <span className={styles.label}>{t(item.label as any)}</span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
};
