import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IoChevronDown, IoChevronForward } from 'react-icons/io5';

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
    onRequestClose?: () => void;
    options: SettingSelectOption[];
    selectButtonClassName?: string;
    selectValueClassName?: string;
};

export type SettingActionItemProps =
    | SettingActionToggleItem
    | SettingActionDisclosureItem
    | SettingActionSelectItem;

type SelectDropdownPosition = {
    top: number;
    left: number;
    width: number;
    maxHeight: number;
};

function cx(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export const SettingActionItem = (props: SettingActionItemProps) => {
    const isSelectMode = props.mode === 'select';
    const isSelectOpen = isSelectMode ? props.open : false;
    const selectRequestClose = isSelectMode ? (props.onRequestClose || props.onToggleOpen) : null;
    const selectOptions = isSelectMode ? props.options : [];
    const selectButtonRef = useRef<HTMLButtonElement | null>(null);
    const [selectDropdownPosition, setSelectDropdownPosition] = useState<SelectDropdownPosition | null>(null);

    const updateSelectDropdownPosition = useCallback(() => {
        if (!isSelectMode || !isSelectOpen || !selectButtonRef.current || typeof window === 'undefined') {
            return;
        }

        const rect = selectButtonRef.current.getBoundingClientRect();
        const viewportPadding = 12;
        const maxWidth = Math.max(180, Math.min(280, window.innerWidth - viewportPadding * 2));
        const width = Math.max(180, Math.min(Math.max(rect.width, 200), maxWidth));
        const left = Math.min(
            Math.max(viewportPadding, rect.right - width),
            Math.max(viewportPadding, window.innerWidth - viewportPadding - width),
        );
        const top = Math.max(viewportPadding, rect.bottom + 8);
        const maxHeight = Math.max(120, window.innerHeight - top - viewportPadding);

        setSelectDropdownPosition({
            top,
            left,
            width,
            maxHeight,
        });
    }, [isSelectMode, isSelectOpen]);

    useLayoutEffect(() => {
        if (!isSelectOpen) {
            return;
        }

        updateSelectDropdownPosition();
    }, [isSelectOpen, updateSelectDropdownPosition]);

    useEffect(() => {
        if (!isSelectOpen || !selectRequestClose || typeof window === 'undefined') {
            return;
        }

        const handleViewportChange = () => {
            updateSelectDropdownPosition();
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                selectRequestClose();
            }
        };

        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('scroll', handleViewportChange, true);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('scroll', handleViewportChange, true);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isSelectOpen, selectRequestClose, updateSelectDropdownPosition]);

    const selectDropdownPortal = (
        isSelectMode
        && isSelectOpen
        && selectDropdownPosition
        && typeof document !== 'undefined'
        && selectRequestClose
    ) ? createPortal(
        <>
            <div
                className={styles.dropdownBackdrop}
                onClick={(event) => {
                    event.stopPropagation();
                    selectRequestClose();
                }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                }}
                aria-hidden="true"
            />
            <div
                className={styles.dropdown}
                style={{
                    top: `${selectDropdownPosition.top}px`,
                    left: `${selectDropdownPosition.left}px`,
                    width: `${selectDropdownPosition.width}px`,
                    maxHeight: `${selectDropdownPosition.maxHeight}px`,
                }}
                onClick={(event) => event.stopPropagation()}
            >
                {selectOptions.map((option) => (
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
        </>,
        document.body,
    ) : null;

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
                        ref={selectButtonRef}
                        className={cx(styles.selectButton, props.selectButtonClassName)}
                        onClick={props.onToggleOpen}
                        disabled={props.disabled}
                    >
                        <span className={cx(styles.selectValue, props.selectValueClassName)}>{props.value}</span>
                        <IoChevronDown
                            size={18}
                            className={cx(styles.chevron, props.open && styles.chevronOpen)}
                        />
                    </button>
                </div>
            );
        }

        return props.trailing || (
            <IoChevronForward
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
            {selectDropdownPortal}
        </div>
    );
};
