import React from 'react';

import styles from './RoundIconButton.module.css';

type RoundIconButtonProps = {
    children: React.ReactNode;
    size?: number;
    className?: string;
} & (
        | ({ as?: 'button' } & React.ButtonHTMLAttributes<HTMLButtonElement>)
        | ({ as: 'span' } & React.HTMLAttributes<HTMLSpanElement>)
    );

function cx(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

function getSizeStyle(style: React.CSSProperties | undefined, size: number): React.CSSProperties {
    return {
        ...style,
        ['--round-icon-size' as string]: `${size}px`,
    };
}

export const RoundIconButton = (props: RoundIconButtonProps) => {
    const {
        as = 'button',
        children,
        size = 44,
        className,
    } = props;

    if (as === 'span') {
        const spanProps = props as ({ as: 'span' } & React.HTMLAttributes<HTMLSpanElement>);
        const { as: _as, style, ...restSpanProps } = spanProps;
        void _as;

        return (
            <span
                className={cx(styles.root, styles.span, className)}
                style={getSizeStyle(style, size)}
                {...restSpanProps}
            >
                {children}
            </span>
        );
    }

    const buttonProps = props as ({ as?: 'button' } & React.ButtonHTMLAttributes<HTMLButtonElement>);
    const {
        as: _as,
        type = 'button',
        style,
        ...restButtonProps
    } = buttonProps;
    void _as;

    return (
        <button
            type={type}
            className={cx(styles.root, styles.button, className)}
            style={getSizeStyle(style, size)}
            {...restButtonProps}
        >
            {children}
        </button>
    );
};
