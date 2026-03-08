import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Single source of truth for allowed origins — used by both CORS (app.ts) and CSRF middleware.
 */
export function getAllowedOrigins(): string[] {
    const fromEnv = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

    if (isDev && fromEnv.length === 0) {
        return ['http://localhost:3000', 'http://127.0.0.1:3000'];
    }

    return fromEnv;
}

// Dev-only: allow cloudflare and ngrok tunnels
function isDevTunnelOrigin(origin: string): boolean {
    if (!isDev) return false;
    return origin.endsWith('.trycloudflare.com')
        || origin.endsWith('.ngrok.io')
        || origin.endsWith('.ngrok-free.app');
}

/**
 * Validates Origin header against allowed origins.
 */
export function validateOrigin(req: Request): boolean {
    const origin = req.headers.origin;

    // Allow requests without origin (server-side proxy, mobile apps, curl)
    if (!origin) return true;

    return getAllowedOrigins().some((allowed) => origin === allowed)
        || isDevTunnelOrigin(origin);
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
 * CSRF Protection Middleware
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
    // 1. Validate Origin
    if (!validateOrigin(req)) {
        console.warn(`Blocked request from origin: ${req.headers.origin}`);
        return res.status(403).json({
            error: 'Forbidden',
            code: 'INVALID_ORIGIN',
        });
    }

    // 2. If initData provided in body, validate it
    const initData = req.body?.initData;
    if (initData) {
        const validation = validateInitData(initData);
        if (!validation.valid) {
            return res.status(401).json({
                error: validation.error,
                code: 'INVALID_INIT_DATA',
            });
        }
    }

    next();
}
