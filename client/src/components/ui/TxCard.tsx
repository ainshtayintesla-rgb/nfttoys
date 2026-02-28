import React from 'react';

import styles from './TxCard.module.css';

interface TxCardProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title'> {
    icon?: React.ReactNode;
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    rightTop?: React.ReactNode;
    rightBottom?: React.ReactNode;
    className?: string;
    rowClassName?: string;
    leftClassName?: string;
    iconWrapClassName?: string;
    textClassName?: string;
    titleClassName?: string;
    subtitleClassName?: string;
    rightClassName?: string;
    rightTopClassName?: string;
    rightBottomClassName?: string;
}

function cx(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export const TxCard = ({
    icon,
    title,
    subtitle,
    rightTop,
    rightBottom,
    className,
    rowClassName,
    leftClassName,
    iconWrapClassName,
    textClassName,
    titleClassName,
    subtitleClassName,
    rightClassName,
    rightTopClassName,
    rightBottomClassName,
    type = 'button',
    ...buttonProps
}: TxCardProps) => {
    return (
        <button
            type={type}
            className={cx(styles.root, className)}
            {...buttonProps}
        >
            <div className={cx(styles.row, rowClassName)}>
                <div className={cx(styles.left, leftClassName)}>
                    {icon && (
                        <span className={cx(styles.iconWrap, iconWrapClassName)}>
                            {icon}
                        </span>
                    )}
                    <div className={cx(styles.text, textClassName)}>
                        <span className={cx(styles.title, titleClassName)}>{title}</span>
                        {subtitle && <span className={cx(styles.subtitle, subtitleClassName)}>{subtitle}</span>}
                    </div>
                </div>
                <div className={cx(styles.right, rightClassName)}>
                    {rightTop && <span className={cx(styles.rightTop, rightTopClassName)}>{rightTop}</span>}
                    {rightBottom && <span className={cx(styles.rightBottom, rightBottomClassName)}>{rightBottom}</span>}
                </div>
            </div>
        </button>
    );
};
