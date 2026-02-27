'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import styles from './page.module.css';

export default function NotTelegramPage() {
    const [botUsername, setBotUsername] = useState<string>('');

    useEffect(() => {
        let isUnmounted = false;

        const loadBotInfo = async () => {
            try {
                const response = await api.telegram.getBotInfo();
                const username = (response.bot?.username || '').trim().replace(/^@+/, '');
                if (!isUnmounted) {
                    setBotUsername(username);
                }
            } catch {
                if (!isUnmounted) {
                    setBotUsername('');
                }
            }
        };

        void loadBotInfo();

        return () => {
            isUnmounted = true;
        };
    }, []);

    const botLink = useMemo(() => {
        return botUsername ? `https://t.me/${botUsername}` : 'https://t.me';
    }, [botUsername]);

    const buttonLabel = useMemo(() => {
        return botUsername ? `@${botUsername} ochish` : 'Botni ochish';
    }, [botUsername]);

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <div className={styles.iconWrapper}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.icon}>
                        <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                        <path d="M12 18h.01" />
                    </svg>
                </div>

                <h1 className={styles.title}>
                    Telegram talab qilinadi
                </h1>

                <p className={styles.description}>
                    Bu ilova faqat Telegram ichida ishlaydi. Iltimos, botimiz orqali oching.
                </p>

                <a
                    href={botLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.button}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                        <path d="M12 9v4" />
                        <path d="M12 17h.01" />
                    </svg>
                    {buttonLabel}
                </a>

                <p className={styles.hint}>
                    Botimizni ochish uchun yuqoridagi tugmani bosing.
                </p>
            </div>
        </div>
    );
}
