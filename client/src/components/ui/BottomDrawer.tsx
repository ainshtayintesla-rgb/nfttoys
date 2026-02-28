'use client';

import React from 'react';
import { ChevronLeft, X } from 'lucide-react';

import styles from './BottomDrawer.module.css';

type DrawerDisplayMode = 'animated' | 'static';

interface BottomDrawerProps {
    open: boolean;
    onClose: () => void;
    title?: React.ReactNode;
    closeAriaLabel?: string;
    backAriaLabel?: string;
    mode?: DrawerDisplayMode;
    onBack?: () => void;
    showBackButton?: boolean;
    closeOnOverlayClick?: boolean;
    hideDragHandle?: boolean;
    hideHeader?: boolean;
    headerContent?: React.ReactNode;
    footer?: React.ReactNode;
    className?: string;
    overlayClassName?: string;
    drawerClassName?: string;
    headerClassName?: string;
    titleClassName?: string;
    closeButtonClassName?: string;
    bodyClassName?: string;
    dragHandleClassName?: string;
    bodyProps?: React.HTMLAttributes<HTMLDivElement>;
    drawerProps?: React.HTMLAttributes<HTMLElement>;
    children: React.ReactNode;
}

function cx(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export const BottomDrawer = ({
    open,
    onClose,
    title,
    closeAriaLabel = 'Close',
    backAriaLabel = 'Back',
    mode = 'animated',
    onBack,
    showBackButton = false,
    closeOnOverlayClick = true,
    hideDragHandle = false,
    hideHeader = false,
    headerContent,
    footer,
    className,
    overlayClassName,
    drawerClassName,
    headerClassName,
    titleClassName,
    closeButtonClassName,
    bodyClassName,
    dragHandleClassName,
    bodyProps,
    drawerProps,
    children,
}: BottomDrawerProps) => {
    const { className: drawerPropsClassName, onClick: onDrawerClick, ...restDrawerProps } = drawerProps || {};
    const { className: bodyPropsClassName, ...restBodyProps } = bodyProps || {};
    const shouldShowBack = showBackButton && typeof onBack === 'function';
    const handleHeaderAction = shouldShowBack ? onBack : onClose;

    return (
        <div
            className={cx(
                styles.overlay,
                open && styles.overlayVisible,
                overlayClassName,
            )}
            onClick={() => {
                if (closeOnOverlayClick) {
                    onClose();
                }
            }}
            aria-hidden={!open}
        >
            <aside
                className={cx(
                    styles.drawer,
                    mode === 'animated' && styles.drawerAnimated,
                    mode === 'static' && styles.drawerStatic,
                    mode === 'animated' && open && styles.drawerOpen,
                    className,
                    drawerClassName,
                    drawerPropsClassName,
                )}
                onClick={(event) => {
                    event.stopPropagation();
                    onDrawerClick?.(event);
                }}
                aria-hidden={!open}
                {...restDrawerProps}
            >
                {!hideDragHandle && (
                    <div className={cx(styles.dragHandle, dragHandleClassName)} />
                )}

                {!hideHeader && (
                    <div className={cx(styles.header, headerClassName)}>
                        {headerContent || (
                            <>
                                <h3 className={cx(styles.title, titleClassName)}>{title}</h3>
                                <button
                                    type="button"
                                    className={cx(styles.closeButton, closeButtonClassName)}
                                    onClick={handleHeaderAction}
                                    aria-label={shouldShowBack ? backAriaLabel : closeAriaLabel}
                                >
                                    {shouldShowBack ? <ChevronLeft size={16} /> : <X size={18} />}
                                </button>
                            </>
                        )}
                    </div>
                )}

                <div className={cx(styles.body, bodyClassName, bodyPropsClassName)} {...restBodyProps}>
                    {children}
                </div>

                {footer}
            </aside>
        </div>
    );
};
