'use client';

import React from 'react';
import Link from 'next/link';

import { Navigation } from '@/components/layout/Navigation';
import { Button } from '@/components/ui/Button';
import { Home, Search } from 'lucide-react';
import styles from './not-found.module.css';

export default function NotFound() {
    return (
        <div className={styles.container}>
            <main className={styles.main}>
                <div className={styles.content}>
                    <div className={styles.errorCode}>
                        <span className={styles.four}>4</span>
                        <div className={styles.zero}>
                            <div className={styles.eye}></div>
                        </div>
                        <span className={styles.four}>4</span>
                    </div>

                    <h1 className={styles.title}>Page Not Found</h1>
                    <p className={styles.description}>
                        Oops! The page you're looking for doesn't exist or has been moved.
                    </p>

                    <div className={styles.actions}>
                        <Link href="/">
                            <Button variant="primary">
                                <Home size={18} />
                                Go Home
                            </Button>
                        </Link>
                        <Link href="/scan">
                            <Button variant="secondary">
                                <Search size={18} />
                                Scan QR
                            </Button>
                        </Link>
                    </div>
                </div>

                <div className={styles.decoration}>
                    <div className={styles.floatingShape}></div>
                    <div className={styles.floatingShape}></div>
                    <div className={styles.floatingShape}></div>
                </div>
            </main>

            <Navigation />
        </div>
    );
}
