import React from 'react';

import styles from './SegmentedTabs.module.css';

export interface SegmentedTabItem<T extends string = string> {
    key: T;
    label: React.ReactNode;
    disabled?: boolean;
}

interface SegmentedTabsProps<T extends string = string> {
    items: SegmentedTabItem<T>[];
    activeKey: T;
    onChange: (nextKey: T) => void;
    ariaLabel?: string;
    className?: string;
    tabClassName?: string;
    activeTabClassName?: string;
    scrollable?: boolean;
}

function cx(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export function SegmentedTabs<T extends string = string>({
    items,
    activeKey,
    onChange,
    ariaLabel,
    className,
    tabClassName,
    activeTabClassName,
    scrollable,
}: SegmentedTabsProps<T>) {
    return (
        <div className={cx(styles.root, scrollable && styles.rootScrollable, className)} role="tablist" aria-label={ariaLabel}>
            {items.map((item) => {
                const isActive = item.key === activeKey;
                return (
                    <button
                        key={item.key}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className={cx(
                            styles.tab,
                            tabClassName,
                            isActive && styles.tabActive,
                            isActive && activeTabClassName,
                            item.disabled && styles.tabDisabled,
                        )}
                        disabled={item.disabled}
                        onClick={() => {
                            if (item.disabled || isActive) {
                                return;
                            }
                            onChange(item.key);
                        }}
                    >
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
}
