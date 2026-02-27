import React from 'react';
import styles from './Card.module.css';

interface CardProps {
    children: React.ReactNode;
    className?: string;
    variant?: 'default' | 'glass' | 'outlined';
    padding?: 'none' | 'sm' | 'md' | 'lg';
    onClick?: () => void;
}

export const Card = ({
    children,
    className = '',
    variant = 'default',
    padding = 'md',
    onClick,
}: CardProps) => {
    return (
        <div
            className={`
        ${styles.card} 
        ${styles[variant]} 
        ${styles[`p-${padding}`]} 
        ${onClick ? styles.interactive : ''} 
        ${className}
      `}
            onClick={onClick}
        >
            {children}
        </div>
    );
};
