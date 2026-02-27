'use client';

import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Smartphone, Scan, Zap, Shield, Users, Gift, Eye, EyeOff } from 'lucide-react';
import { TgsPlayer } from '@/components/ui/TgsPlayer';
import styles from './page.module.css';

interface Slide {
    id: number;
    title: string;
    subtitle?: string;
    content: React.ReactNode;
    icon?: React.ReactNode;
}

// Batch 1 models with TGS files
const batch1Models = {
    legendary: [
        { name: 'X-Ray', qty: 1, tgs: 'x-ray.tgs' },
        { name: 'Cozy Galaxy', qty: 1, tgs: 'cozy_galaxy.tgs' },
        { name: 'Gucci Leap', qty: 1, tgs: 'gucci leap.tgs' },
        { name: 'Aqua Plush', qty: 1, tgs: 'aqua_plush.tgs' },
    ],
    rare: [
        { name: 'Magnate', qty: 2, tgs: 'magnate.tgs' },
        { name: 'Amalgam', qty: 2, tgs: 'amalgam.tgs' },
        { name: 'Stripes', qty: 2, tgs: 'stripes.tgs' },
        { name: 'Frozen', qty: 2, tgs: 'frozen.tgs' },
        { name: 'Hue Jester', qty: 2, tgs: 'hue_jester.tgs' },
        { name: 'Hot Head', qty: 2, tgs: 'hot_head.tgs' },
        { name: 'Princess', qty: 2, tgs: 'princess.tgs' },
        { name: 'Pink Latex', qty: 2, tgs: 'pink_latex.tgs' },
    ],
    common: [
        { name: 'Ninja Mike', qty: 6, tgs: 'ninja_mike.tgs' },
        { name: 'Raphael', qty: 6, tgs: 'raphael.tgs' },
        { name: 'Bavaria', qty: 6, tgs: 'bavariya.tgs' },
        { name: 'Red Pepple', qty: 6, tgs: 'red_pepple.tgs' },
        { name: 'Louis Vuittoad', qty: 6, tgs: 'louis_vuittoad.tgs' },
        { name: 'Milano', qty: 6, tgs: 'milano.tgs' },
        { name: 'Barcelona', qty: 6, tgs: 'barcelona.tgs' },
        { name: 'Leonardo', qty: 6, tgs: 'leonardo.tgs' },
        { name: 'Donatello', qty: 6, tgs: 'donatello.tgs' },
        { name: 'Two Face', qty: 6, tgs: 'two_face.tgs' },
        { name: 'Yellow Hug', qty: 6, tgs: 'yellow_hug.tgs' },
        { name: 'Pumpkin', qty: 7, tgs: 'pumpkin.tgs' },
        { name: 'Sunset', qty: 7, tgs: 'sunset.tgs' },
    ]
};

export default function PresentationPage() {
    const [currentSlide, setCurrentSlide] = useState(0);
    const [isAnimating, setIsAnimating] = useState(false);

    const slides: Slide[] = [
        {
            id: 0,
            title: "NFT Toys",
            subtitle: "Kolleksion NFT o'yinchoqlar",
            content: (
                <div className={styles.heroContent}>
                    <div className={styles.heroAnimation}>
                        <TgsPlayer src="/models/raphael.tgs" style={{ width: 200, height: 200 }} loop autoplay />
                    </div>
                    <p className={styles.tagline}>Jismoniy o'yinchoq + Raqamli NFT</p>
                </div>
            )
        },
        {
            id: 1,
            title: "Muammo",
            icon: <span className={styles.emoji}>🤔</span>,
            content: (
                <ul className={styles.bulletList}>
                    <li>Soxta kolleksion o'yinchoqlar</li>
                    <li>Haqiqiylikni tasdiqlash yo'q</li>
                    <li>Qayta sotish qiyinchiligi</li>
                    <li>Egalik tarixi yo'q</li>
                </ul>
            )
        },
        {
            id: 2,
            title: "Yechim",
            icon: <span className={styles.emoji}>💡</span>,
            content: (
                <ul className={styles.bulletList}>
                    <li><strong>NFC chip</strong> har bir o'yinchoqda</li>
                    <li><strong>NFT token</strong> egalikni tasdiqlaydi</li>
                    <li><strong>QR kod</strong> aktivlashtirish uchun</li>
                    <li><strong>Blockchain</strong> egalik tarixi</li>
                </ul>
            )
        },
        {
            id: 3,
            title: "Qanday ishlaydi",
            icon: <Scan size={48} className={styles.slideIcon} />,
            content: (
                <div className={styles.stepsWrapper}>
                    <div className={styles.stepsGrid}>
                        <div className={styles.step}>
                            <span className={styles.stepNum}>1</span>
                            <p>O'yinchoq sotib olish</p>
                        </div>
                        <div className={styles.step}>
                            <span className={styles.stepNum}>2</span>
                            <p>QR kodni skanerlash</p>
                        </div>
                        <div className={styles.step}>
                            <span className={styles.stepNum}>3</span>
                            <p>NFT ni aktivlashtirish</p>
                        </div>
                        <div className={styles.step}>
                            <span className={styles.stepNum}>4</span>
                            <p>Egalik tasdiqlandi</p>
                        </div>
                    </div>
                    <a href="/admin" className={styles.demoBtn} target="_blank">
                        Demo ko'rish →
                    </a>
                </div>
            )
        },
        {
            id: 4,
            title: "Bizning Maqsad",
            icon: <span className={styles.emoji}>🇺🇿</span>,
            content: (
                <div className={styles.visionContent}>
                    <p className={styles.visionText}>
                        <strong>O'zbekistonni raqamlashtirish</strong> — bizning asosiy maqsadimiz.
                        Jismoniy narsalardan raqamli texnologiyalarga o'tish — bu kelajak.
                    </p>
                    <div className={styles.comparisonGrid}>
                        <div className={styles.comparisonItem}>
                            <span className={styles.comparisonIcon}>📦</span>
                            <span className={styles.comparisonTitle}>Jismoniy</span>
                            <ul className={styles.comparisonList}>
                                <li>❌ Nusxa ko'chirish mumkin</li>
                                <li>❌ Soxtalash oson</li>
                                <li>❌ Buzilishi mumkin</li>
                            </ul>
                        </div>
                        <div className={styles.comparisonItem}>
                            <span className={styles.comparisonIcon}>💎</span>
                            <span className={styles.comparisonTitle}>Raqamli</span>
                            <ul className={styles.comparisonList}>
                                <li>✅ Nusxa ko'chirib bo'lmaydi</li>
                                <li>✅ Soxtalash imkonsiz</li>
                                <li>✅ Abadiy saqlanadi</li>
                            </ul>
                        </div>
                    </div>
                    <p className={styles.visionNote}>
                        Yagona xavf — tizimni buzish. Biz uni har qanday usullar bilan himoya qilamiz!
                    </p>
                </div>
            )
        },
        {
            id: 5,
            title: "Kolleksiya",
            content: (
                <div className={styles.collectionGrid}>
                    <div className={styles.collectionItem}>
                        <TgsPlayer src="/models/midas_pepe.tgs" style={{ width: 100, height: 100 }} loop autoplay />
                        <span>Legendary</span>
                    </div>
                    <div className={styles.collectionItem}>
                        <TgsPlayer src="/models/spectrum.tgs" style={{ width: 100, height: 100 }} loop autoplay />
                        <span>Rare</span>
                    </div>
                    <div className={styles.collectionItem}>
                        <TgsPlayer src="/models/ninja_mike.tgs" style={{ width: 100, height: 100 }} loop autoplay />
                        <span>Common</span>
                    </div>
                </div>
            )
        },
        {
            id: 6,
            title: "Ishlab chiqarish",
            icon: <span className={styles.emoji}>📦</span>,
            content: (
                <div className={styles.calcWrapper}>
                    <div className={styles.calcContent}>
                        <div className={styles.calcRow}>
                            <span className={styles.calcLabel}>Modellar soni:</span>
                            <span className={styles.calcValue}>49 ta → <strong>25 ta</strong></span>
                        </div>
                        <div className={styles.calcRow}>
                            <span className={styles.calcLabel}>Partiyalar:</span>
                            <span className={styles.calcValue}>25 × 4 = <strong>100 ta</strong> o'yinchoq</span>
                        </div>
                        <div className={styles.calcDivider} />
                        <div className={styles.rarityBreakdown}>
                            <div className={styles.rarityItem}>
                                <span className={styles.rarityDot} style={{ background: '#fbbf24' }} />
                                <span>Legendary: 4 model × 1 = <strong>4 ta</strong></span>
                            </div>
                            <div className={styles.rarityItem}>
                                <span className={styles.rarityDot} style={{ background: '#3b82f6' }} />
                                <span>Rare: 8 model × 2 = <strong>16 ta</strong></span>
                            </div>
                            <div className={styles.rarityItem}>
                                <span className={styles.rarityDot} style={{ background: '#9ca3af' }} />
                                <span>Common: 13 model = <strong>80 ta</strong></span>
                            </div>
                        </div>
                    </div>

                    <button
                        className={styles.showModelsBtn}
                        onClick={() => goToSlide(currentSlide + 1)}
                    >
                        <Eye size={18} />
                        Modellarni ko'rish →
                    </button>
                </div>
            )
        },
        {
            id: 7,
            title: "1-Partiya Modellari",
            content: (
                <div className={styles.modelsShowcase}>
                    <div className={styles.modelSection}>
                        <h3 className={styles.sectionTitle} style={{ color: '#fbbf24' }}>🟡 Legendary (×1)</h3>
                        <div className={styles.modelGrid}>
                            {batch1Models.legendary.map(m => (
                                <div key={m.name} className={styles.modelCard}>
                                    <TgsPlayer src={`/models/${m.tgs}`} style={{ width: 60, height: 60 }} autoplay={false} />
                                    <span className={styles.modelName}>{m.name}</span>
                                    <span className={styles.modelQty}>×{m.qty}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className={styles.modelSection}>
                        <h3 className={styles.sectionTitle} style={{ color: '#3b82f6' }}>🔵 Rare (×2)</h3>
                        <div className={styles.modelGrid}>
                            {batch1Models.rare.map(m => (
                                <div key={m.name} className={styles.modelCard}>
                                    <TgsPlayer src={`/models/${m.tgs}`} style={{ width: 60, height: 60 }} autoplay={false} />
                                    <span className={styles.modelName}>{m.name}</span>
                                    <span className={styles.modelQty}>×{m.qty}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className={styles.modelSection}>
                        <h3 className={styles.sectionTitle} style={{ color: '#9ca3af' }}>⚪ Common (×6-7)</h3>
                        <div className={styles.modelGrid}>
                            {batch1Models.common.map(m => (
                                <div key={m.name} className={styles.modelCard}>
                                    <TgsPlayer src={`/models/${m.tgs}`} style={{ width: 60, height: 60 }} autoplay={false} />
                                    <span className={styles.modelName}>{m.name}</span>
                                    <span className={styles.modelQty}>×{m.qty}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )
        },
        {
            id: 8,
            title: "Qadoqlash",
            content: (
                <div className={styles.packagingFlow}>
                    <div className={styles.packagingItem}>
                        <TgsPlayer src="/models/midas_pepe.tgs" style={{ width: 100, height: 100 }} loop autoplay />
                        <span>O'yinchoq</span>
                    </div>
                    <div className={styles.packagingArrow}>
                        <svg width="100" height="50" viewBox="0 0 100 50">
                            <defs>
                                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                    <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
                                </marker>
                            </defs>
                            <path
                                d="M10 40 Q 50 5, 90 25"
                                stroke="currentColor"
                                strokeWidth="3"
                                fill="none"
                                strokeLinecap="round"
                                markerEnd="url(#arrowhead)"
                            />
                        </svg>
                    </div>
                    <div className={styles.packagingItem}>
                        <TgsPlayer src="/animations/box.tgs" style={{ width: 120, height: 120 }} loop autoplay />
                        <span>Quti</span>
                    </div>
                </div>
            )
        },
        {
            id: 9,
            title: "Rahmat!",
            subtitle: "Savollar?",
            content: (
                <div className={styles.heroContent}>
                    <div className={styles.heroAnimation}>
                        <TgsPlayer src="/animations/only_up.tgs" style={{ width: 150, height: 150 }} loop autoplay />
                    </div>
                    <p className={styles.tagline}>nfttoys.uz</p>
                </div>
            )
        }
    ];

    const goToSlide = (index: number) => {
        if (isAnimating || index === currentSlide) return;
        if (index < 0 || index >= slides.length) return;

        setIsAnimating(true);
        setCurrentSlide(index);
        setTimeout(() => setIsAnimating(false), 300);
    };

    const nextSlide = () => goToSlide(currentSlide + 1);
    const prevSlide = () => goToSlide(currentSlide - 1);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight' || e.key === ' ') {
                e.preventDefault();
                nextSlide();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                prevSlide();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [currentSlide, isAnimating]);

    const slide = slides[currentSlide];

    return (
        <div className={styles.container}>
            {/* Progress bar */}
            <div className={styles.progressBar}>
                <div
                    className={styles.progress}
                    style={{ width: `${((currentSlide + 1) / slides.length) * 100}%` }}
                />
            </div>

            {/* Slide content */}
            <main
                className={`${styles.slide} ${isAnimating ? styles.animating : ''}`}
                key={slide.id}
            >
                {slide.icon && <div className={styles.iconWrapper}>{slide.icon}</div>}
                <h1 className={styles.title}>{slide.title}</h1>
                {slide.subtitle && <h2 className={styles.subtitle}>{slide.subtitle}</h2>}
                <div className={styles.content}>{slide.content}</div>
            </main>

            {/* Navigation */}
            <nav className={styles.navigation}>
                <button
                    className={styles.navBtn}
                    onClick={prevSlide}
                    disabled={currentSlide === 0}
                >
                    <ChevronLeft size={24} />
                </button>

                <div className={styles.dots}>
                    {slides.map((_, idx) => (
                        <button
                            key={idx}
                            className={`${styles.dot} ${idx === currentSlide ? styles.activeDot : ''}`}
                            onClick={() => goToSlide(idx)}
                        />
                    ))}
                </div>

                <button
                    className={styles.navBtn}
                    onClick={nextSlide}
                    disabled={currentSlide === slides.length - 1}
                >
                    <ChevronRight size={24} />
                </button>
            </nav>

            {/* Slide counter */}
            <div className={styles.counter}>
                {currentSlide + 1} / {slides.length}
            </div>
        </div>
    );
}
