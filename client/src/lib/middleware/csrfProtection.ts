import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Allowed origins for CORS/CSRF protection
const ALLOWED_ORIGINS = [
    'https://nfttoys.shop',
    'https://www.nfttoys.shop',
    'https://web.telegram.org',
    'https://telegram.org',
];

// In development, allow localhost and cloudflared tunnels
if (process.env.NODE_ENV === 'development') {
    ALLOWED_ORIGINS.push('http://localhost:3000');
    ALLOWED_ORIGINS.push('http://127.0.0.1:3000');
}

// Check if origin is cloudflared tunnel (in development)
function isCloudflaredOrigin(origin: string): boolean {
    return origin.endsWith('.trycloudflare.com');
}

// Check if origin is ngrok tunnel (in development)
function isNgrokOrigin(origin: string): boolean {
    return origin.endsWith('.ngrok.io') || origin.endsWith('.ngrok-free.app');
}

/**
 * Validates Origin header against allowed origins
 */
export function validateOrigin(request: NextRequest): NextResponse | null {
    const origin = request.headers.get('origin');

    // Allow requests without origin (same-origin, mobile apps)
    if (!origin) return null;

    // Check if origin is allowed OR is a dev tunnel (cloudflare/ngrok)
    const isAllowed = ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed))
        || isCloudflaredOrigin(origin)
        || isNgrokOrigin(origin);

    if (!isAllowed) {
        console.warn(`Blocked request from origin: ${origin}`);
        return NextResponse.json(
            { error: 'Forbidden', code: 'INVALID_ORIGIN' },
            { status: 403 }
        );
    }

    return null;
}

/**
 * Validates Telegram initData signature
 */
export function validateInitData(initData: string): {
    valid: boolean;
    userId?: number;
    error?: string;
} {
    const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
        console.error('BOT_TOKEN not configured');
        return { valid: false, error: 'Server configuration error' };
    }

    if (!initData) {
        return { valid: false, error: 'initData required' };
    }

    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');

        if (!hash) {
            return { valid: false, error: 'No hash in initData' };
        }

        // Check auth_date expiry (24 hours)
        const authDate = parseInt(params.get('auth_date') || '0', 10);
        const now = Math.floor(Date.now() / 1000);
        if (now - authDate > 86400) {
            return { valid: false, error: 'initData expired' };
        }

        // Remove hash and sort params
        params.delete('hash');
        const sortedParams = Array.from(params.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        // Create secret key and validate hash
        const secretKey = crypto
            .createHmac('sha256', 'WebAppData')
            .update(botToken)
            .digest();

        const expectedHash = crypto
            .createHmac('sha256', secretKey)
            .update(sortedParams)
            .digest('hex');

        // Timing-safe comparison
        if (hash.length !== expectedHash.length ||
            !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash))) {
            return { valid: false, error: 'Invalid signature' };
        }

        // Extract user ID
        const userStr = params.get('user');
        let userId: number | undefined;
        if (userStr) {
            try {
                const user = JSON.parse(userStr);
                userId = user.id;
            } catch {
                // User parsing failed, but signature is valid
            }
        }

        return { valid: true, userId };

    } catch (error) {
        console.error('initData validation error:', error);
        return { valid: false, error: 'Validation failed' };
    }
}

/**
 * Combined CSRF protection middleware
 * Validates both Origin and initData
 */
export function csrfProtection(request: NextRequest, initData?: string): NextResponse | null {
    // 1. Validate Origin
    const originError = validateOrigin(request);
    if (originError) return originError;

    // 2. If initData provided, validate it
    if (initData) {
        const validation = validateInitData(initData);
        if (!validation.valid) {
            return NextResponse.json(
                { error: validation.error, code: 'INVALID_INIT_DATA' },
                { status: 401 }
            );
        }
    }

    return null;
}
