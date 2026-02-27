'use client';

import React from 'react';
import styles from './AppLoader.module.css';

interface AppLoaderProps {
    message?: string;
}

export const AppLoader = ({ message = 'Loading...' }: AppLoaderProps) => {
    return (
        <div className={styles.container}>
            <div className={styles.content}>
                {/* Logo placeholder */}
                <div className={styles.logo}>
                    <div className={styles.logoInner}></div>
                </div>

                {/* Skeleton cards */}
                <div className={styles.skeletonGroup}>
                    <div className={styles.skeletonCard}>
                        <div className={styles.skeletonAvatar}></div>
                        <div className={styles.skeletonLines}>
                            <div className={styles.skeletonLine} style={{ width: '60%' }}></div>
                            <div className={styles.skeletonLine} style={{ width: '40%' }}></div>
                        </div>
                    </div>

                    <div className={styles.skeletonCard}>
                        <div className={styles.skeletonLine} style={{ width: '80%' }}></div>
                        <div className={styles.skeletonLine} style={{ width: '100%' }}></div>
                    </div>

                    <div className={styles.skeletonGrid}>
                        <div className={styles.skeletonBox}></div>
                        <div className={styles.skeletonBox}></div>
                        <div className={styles.skeletonBox}></div>
                    </div>
                </div>

                {/* Loading indicator */}
                <div className={styles.loader}>
                    <div className={styles.spinner}></div>
                </div>
            </div>
        </div>
    );
};
