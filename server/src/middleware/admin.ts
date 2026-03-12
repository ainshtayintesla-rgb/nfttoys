import { NextFunction, Request, Response } from 'express';
import { extractAdminSessionToken, verifyAdminSessionToken, AdminSessionPayload } from './adminSession';

function parseAdminIds(raw: string): string[] {
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

export function getAdminTelegramIds(): string[] {
    // Read exclusively from server-side env vars.
    // ADMIN_IDS is the canonical var; ADMIN_TELEGRAM_IDS is an alias.
    // NEXT_PUBLIC_ADMIN_IDS must NOT be used here — it is a public frontend var.
    return parseAdminIds(process.env.ADMIN_IDS || process.env.ADMIN_TELEGRAM_IDS || '');
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
    // Option A: AdminAccount session JWT
    const sessionToken = extractAdminSessionToken(req);
    if (sessionToken) {
        const session = verifyAdminSessionToken(sessionToken);
        if (session) {
            (req as Request & { adminSession?: AdminSessionPayload }).adminSession = session;
            return next();
        }
        return res.status(401).json({ error: 'Invalid admin session', code: 'INVALID_SESSION' });
    }

    // Option B: Telegram-based admin (ADMIN_IDS env var)
    if (!req.authUser) {
        return res.status(401).json({
            error: 'Authorization token is required',
            code: 'UNAUTHORIZED',
        });
    }

    const adminIds = getAdminTelegramIds();

    if (adminIds.length === 0) {
        return res.status(500).json({
            error: 'Admin IDs are not configured',
            code: 'ADMIN_CONFIG_ERROR',
        });
    }

    const telegramId = String(req.authUser.telegramId);
    if (!adminIds.includes(telegramId)) {
        return res.status(403).json({
            error: 'Admin access required',
            code: 'FORBIDDEN',
        });
    }

    return next();
}
