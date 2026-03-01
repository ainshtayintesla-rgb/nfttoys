'use client';

import React from 'react';

import styles from './Skeleton.module.css';

type SkeletonSize = number | string;

interface SkeletonBaseProps extends React.HTMLAttributes<HTMLDivElement> {
    width?: SkeletonSize;
    height?: SkeletonSize;
    radius?: SkeletonSize;
}

function sizeToStyle(value: SkeletonSize | undefined): string | undefined {
    if (value === undefined) {
        return undefined;
    }

    return typeof value === 'number' ? `${value}px` : value;
}

function joinClassNames(...values: Array<string | undefined | false>): string {
    return values.filter(Boolean).join(' ');
}

export function Skeleton({
    width,
    height,
    radius,
    className,
    style,
    ...rest
}: SkeletonBaseProps) {
    const mergedStyle: React.CSSProperties = {
        ...style,
        ...(width !== undefined ? { width: sizeToStyle(width) } : {}),
        ...(height !== undefined ? { height: sizeToStyle(height) } : {}),
        ...(radius !== undefined ? { borderRadius: sizeToStyle(radius) } : {}),
    };

    return <div aria-hidden="true" className={joinClassNames(styles.skeleton, className)} style={mergedStyle} {...rest} />;
}

interface SkeletonLineProps extends Omit<SkeletonBaseProps, 'radius'> {
    width?: SkeletonSize;
    height?: SkeletonSize;
}

export function SkeletonLine({ width = '100%', height = 12, className, ...rest }: SkeletonLineProps) {
    return (
        <Skeleton
            width={width}
            height={height}
            className={joinClassNames(styles.line, className)}
            {...rest}
        />
    );
}

interface SkeletonCircleProps extends Omit<SkeletonBaseProps, 'radius' | 'width' | 'height'> {
    size?: SkeletonSize;
}

export function SkeletonCircle({ size = 20, className, ...rest }: SkeletonCircleProps) {
    const resolvedSize = sizeToStyle(size) || '20px';

    return (
        <Skeleton
            width={resolvedSize}
            height={resolvedSize}
            className={joinClassNames(styles.circle, className)}
            {...rest}
        />
    );
}
