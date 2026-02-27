import React from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Toy } from '@/lib/mock/toys';
import styles from './ToyCard.module.css';
import { useLanguage } from '@/lib/context/LanguageContext';
import { Image as ImageIcon, Zap, Tag, CheckCircle2, Send } from 'lucide-react';
import { TgsPlayer } from '@/components/ui/TgsPlayer';

interface ToyCardProps {
    toy: Toy;
    onBuy?: (toy: Toy) => void;
    onClick?: (toy: Toy) => void;
    onTransfer?: (toy: Toy) => void;
    isOwner?: boolean;
    actionButton?: React.ReactNode;
}

export const ToyCard = ({ toy, onBuy, onClick, onTransfer, isOwner = false, actionButton }: ToyCardProps) => {
    const { t } = useLanguage();
    const router = useRouter();

    const handleCardClick = () => {
        if (onClick) {
            onClick(toy);
        } else {
            router.push(`/toy/${toy.id}`);
        }
    };

    return (
        <Card
            onClick={handleCardClick}
            className={styles.toyCard}
            padding="none"
            variant="glass"
        >
            <div className={styles.imageContainer}>
                {toy.tgsUrl ? (
                    <div className={`${styles.imagePlaceholder} ${styles[toy.rarity]}`} style={{ background: 'transparent' }}>
                        <TgsPlayer
                            src={toy.tgsUrl}
                            style={{ width: '100%', height: '100%' }}
                            playOnHover={true}
                        />
                    </div>
                ) : (
                    <div className={`${styles.imagePlaceholder} ${styles[toy.rarity]}`}>
                        <ImageIcon size={48} strokeWidth={1} className={styles.placeholderIcon} />
                    </div>
                )}
            </div>

            <div className={styles.content}>
                <div className={styles.header}>
                    <h3 className={styles.name}>{toy.name}</h3>
                    {(toy as any).serialNumber && (
                        <span className={styles.serialNumber}>
                            #{parseInt((toy as any).serialNumber.replace('#', ''), 10)}
                        </span>
                    )}
                </div>

                <div className={styles.footer}>
                    <div className={styles.priceContainer} style={{ flexDirection: 'row', alignItems: 'center', gap: '6px' }}>
                        <span className={styles.priceLabel} style={{ marginBottom: 0, fontSize: '13px' }}>{t('price')}</span>
                        <div className={styles.price} style={{ fontSize: '14px' }}>
                            {toy.price.toLocaleString('de-DE')}
                        </div>
                    </div>

                    {/* Custom Action Button Override */}
                    {actionButton ? (
                        <div className={styles.customAction}>
                            {actionButton}
                        </div>
                    ) : isOwner ? (
                        <Button
                            size="sm"
                            className={styles.buyBtn}
                            onClick={(e) => {
                                e.stopPropagation();
                                onTransfer?.(toy);
                            }}
                        >
                            <Send size={14} />
                            {t('transfer') || 'Transfer'}
                        </Button>
                    ) : toy.status === 'available' ? (
                        <Button
                            size="sm"
                            className={styles.buyBtn}
                            onClick={(e) => {
                                e.stopPropagation();
                                onBuy?.(toy);
                            }}
                        >
                            <Zap size={14} fill="currentColor" />
                            {t('buy')}
                        </Button>
                    ) : (
                        <div className={styles.statusBadge}>
                            <CheckCircle2 size={14} />
                            <span>{t('activated')}</span>
                        </div>
                    )}
                </div>
            </div>
        </Card>
    );
};
