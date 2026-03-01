'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import styles from '../page.module.css';

interface AdminCustomSelectProps {
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    error?: boolean;
}

export const AdminCustomSelect = ({
    value,
    options,
    onChange,
    placeholder,
    disabled = false,
    error = false,
}: AdminCustomSelectProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedOption = options.find((option) => option.value === value);

    return (
        <div className={styles.selectContainer} ref={containerRef}>
            <button
                type="button"
                className={`${styles.selectTrigger} ${isOpen ? styles.active : ''} ${disabled ? styles.disabled : ''} ${error ? styles.inputError : ''}`}
                onClick={() => !disabled && setIsOpen((current) => !current)}
                disabled={disabled}
            >
                <span>{selectedOption ? selectedOption.label : placeholder}</span>
                <ChevronDown size={16} className={`${styles.chevron} ${isOpen ? styles.rotate : ''}`} />
            </button>

            {isOpen && (
                <div className={`${styles.selectDropdown} ${styles.open}`}>
                    {options.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            className={`${styles.selectOption} ${value === option.value ? styles.selected : ''}`}
                            onClick={() => {
                                onChange(option.value);
                                setIsOpen(false);
                            }}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
