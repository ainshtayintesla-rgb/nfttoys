import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import styles from './SettingActionItem.module.css';

type SettingActionItemBase = {
    icon: React.ReactNode;
    label: React.ReactNode;
    subtitle?: React.ReactNode;
    iconBackground?: string;
    disabled?: boolean;
    className?: string;
};

type SettingSelectOption = {
    key: string;
    label: React.ReactNode;
    onSelect: () => void;
    active?: boolean;
    disabled?: boolean;
};

type SettingActionToggleItem = SettingActionItemBase & {
    mode: 'toggle';
    checked: boolean;
    onCheckedChange: (nextValue: boolean) => void;
    ariaLabel?: string;
    afterControl?: React.ReactNode;
    controlMuted?: boolean;
};

type SettingActionDisclosureItem = SettingActionItemBase & {
    mode: 'disclosure';
    onPress: () => void;
    expanded?: boolean;
    trailing?: React.ReactNode;
};

type SettingActionSelectItem = SettingActionItemBase & {
    mode: 'select';
    value: React.ReactNode;
    open: boolean;
    onToggleOpen: () => void;
    options: SettingSelectOption[];
};

export type SettingActionItemProps =
    | SettingActionToggleItem
    | SettingActionDisclosureItem
    | SettingActionSelectItem;

function cx(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export const SettingActionItem = (props: SettingActionItemProps) => {
    const iconStyle = props.iconBackground
        ? { background: props.iconBackground }
        : undefined;

    const handleActivate = () => {
        if (props.disabled) {
            return;
        }

        if (props.mode === 'toggle') {
            props.onCheckedChange(!props.checked);
            return;
        }

        if (props.mode === 'select') {
            props.onToggleOpen();
            return;
        }

        props.onPress();
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (props.disabled) {
            return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleActivate();
        }
    };

    const renderControl = () => {
        if (props.mode === 'toggle') {
            return (
                <div
                    className={styles.controls}
                    onClick={(event) => event.stopPropagation()}
                >
                    <button
                        type="button"
                        className={cx(
                            styles.toggle,
                            props.checked && styles.toggleOn,
                            (props.disabled || props.controlMuted) && styles.toggleDisabled
                        )}
                        onClick={() => {
                            if (props.disabled) {
                                return;
                            }
                            props.onCheckedChange(!props.checked);
                        }}
                        disabled={props.disabled}
                        aria-label={props.ariaLabel}
                        aria-pressed={props.checked}
                    >
                        <span className={styles.toggleThumb}></span>
                    </button>
                    {props.afterControl && (
                        <span className={styles.afterControl}>
                            {props.afterControl}
                        </span>
                    )}
                </div>
            );
        }

        if (props.mode === 'select') {
            return (
                <div
                    className={styles.selectWrap}
                    onClick={(event) => event.stopPropagation()}
                >
                    <button
                        type="button"
                        className={styles.selectButton}
                        onClick={props.onToggleOpen}
                        disabled={props.disabled}
                    >
                        <span className={styles.selectValue}>{props.value}</span>
                        <ChevronDown
                            size={18}
                            className={cx(styles.chevron, props.open && styles.chevronOpen)}
                        />
                    </button>
                    {props.open && (
                        <div
                            className={styles.dropdown}
                            onClick={(event) => event.stopPropagation()}
                        >
                            {props.options.map((option) => (
                                <button
                                    key={option.key}
                                    type="button"
                                    className={cx(
                                        styles.dropdownItem,
                                        option.active && styles.dropdownItemActive
                                    )}
                                    onClick={option.onSelect}
                                    disabled={option.disabled}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            );
        }

        return props.trailing || (
            <ChevronRight
                size={20}
                className={cx(styles.arrow, props.expanded && styles.arrowExpanded)}
            />
        );
    };

    return (
        <div
            className={cx(styles.item, props.disabled && styles.itemDisabled, props.className)}
            role={props.disabled ? undefined : 'button'}
            tabIndex={props.disabled ? -1 : 0}
            onClick={handleActivate}
            onKeyDown={handleKeyDown}
            aria-disabled={props.disabled}
        >
            <span className={styles.left}>
                <span className={styles.iconWrap} style={iconStyle}>
                    {props.icon}
                </span>
                <span className={styles.content}>
                    <span className={styles.label}>{props.label}</span>
                    {props.subtitle && (
                        <span className={styles.subtitle}>{props.subtitle}</span>
                    )}
                </span>
            </span>
            <span className={styles.right}>{renderControl()}</span>
        </div>
    );
};
