'use client';

import React from 'react';

import { Navigation } from '@/components/layout/Navigation';
import { PEPE_MODELS } from '@/lib/data/pepe_models';
import { TgsPlayer } from '@/components/ui/TgsPlayer';
import styles from './page.module.css';
import { useLanguage } from '@/lib/context/LanguageContext';

export default function Home() {
    const { t } = useLanguage();

    return (
        <div className={styles.container}>

            <main className={styles.main}>
                <div className={styles.hero}>
                    <h2 className={styles.heroTitle}>{t('welcome')}</h2>
                    <p className={styles.heroSubtitle}>Discover exclusive NFT Plush Toys</p>
                </div>

                <div className={styles.grid}>
                    {PEPE_MODELS.map((model) => (
                        <div key={model.name} className={styles.modelCard}>
                            <div className={styles.modelImage}>
                                <TgsPlayer
                                    src={`/models/${model.tgsFile}`}
                                    style={{ width: 100, height: 100 }}
                                    autoplay={false}
                                    playOnHover
                                    playOnTap
                                    renderer="svg"
                                />
                            </div>
                            <div className={styles.modelInfo}>
                                <span className={styles.modelName}>{model.name}</span>
                                <span className={`${styles.modelRarity} ${styles[model.rarity]}`}>
                                    {model.rarity}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </main>

            <Navigation />
        </div>
    );
}
