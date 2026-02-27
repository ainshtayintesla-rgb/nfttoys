import React from 'react';

interface VerifiedBadgeProps {
    size?: number;
    className?: string; // Allow custom classes for positioning/margins
}

export const VerifiedBadge = ({ size = 20, className = '' }: VerifiedBadgeProps) => {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
        >
            {/* Material Design Verified Badge Shape (Wavy/Scissor cut) */}
            <path
                d="M23 12l-2.44-2.79.34-3.69-3.61-.82-1.89-3.2L12 2.96 8.6 1.5 6.71 4.69 3.1 5.5l.34 3.69L1 12l2.44 2.79-.34 3.69 3.61.82 1.89 3.2L12 21.04l3.4 1.46 1.89-3.19 3.61-.82-.34-3.69L23 12z"
                fill="#3390ec"
            />
            {/* Checkmark */}
            <path
                d="M10.09 16.72l-3.8-3.81 1.48-1.48 2.32 2.33 5.85-5.87 1.48 1.48-7.33 7.35z"
                fill="white"
            />
        </svg>
    );
};
