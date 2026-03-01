import React from 'react';
import { ChevronRight } from 'lucide-react';

import styles from './ActionLinkList.module.css';

export interface ActionLinkItem {
    key: string;
    icon: React.ReactNode;
    label: React.ReactNode;
    subtitle?: React.ReactNode;
    href?: string;
    onClick?: () => void;
    external?: boolean;
    disabled?: boolean;
    iconBackground?: string;
}

interface ActionLinkListProps {
    items: ActionLinkItem[];
    joined?: boolean;
    className?: string;
}

function cx(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export const ActionLinkList = ({
    items,
    joined = true,
    className,
}: ActionLinkListProps) => {
    const visibleItems = items.filter(Boolean);

    if (visibleItems.length === 0) {
        return null;
    }

    return (
        <div className={cx(styles.group, joined ? styles.joined : styles.stacked, className)}>
            {visibleItems.map((item, index) => {
                const handleClick = () => {
                    if (item.disabled) {
                        return;
                    }

                    if (item.onClick) {
                        item.onClick();
                        return;
                    }

                    if (!item.href) {
                        return;
                    }

                    if (item.external) {
                        window.open(item.href, '_blank', 'noopener,noreferrer');
                        return;
                    }

                    window.location.href = item.href;
                };

                const iconStyle = item.iconBackground
                    ? { background: item.iconBackground }
                    : undefined;

                return (
                    <React.Fragment key={item.key}>
                        <button
                            type="button"
                            className={cx(styles.item, item.disabled && styles.itemDisabled)}
                            onClick={handleClick}
                            disabled={item.disabled}
                        >
                            <span className={styles.left}>
                                <span className={styles.iconWrap} style={iconStyle}>
                                    {item.icon}
                                </span>
                                <span className={styles.content}>
                                    <span className={styles.label}>{item.label}</span>
                                    {item.subtitle && (
                                        <span className={styles.subtitle}>{item.subtitle}</span>
                                    )}
                                </span>
                            </span>
                            <ChevronRight size={20} className={styles.arrow} />
                        </button>
                        {joined && index < visibleItems.length - 1 && (
                            <div className={styles.divider} />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
};
