import { NextFunction, Request, Response } from 'express';

export function getOwnerTelegramId(): string {
    return (process.env.OWNER_TELEGRAM_ID || '').trim();
}

export function requireOwner(req: Request, res: Response, next: NextFunction) {
    if (!req.authUser) {
        return res.status(401).json({
            error: 'Authorization token is required',
            code: 'UNAUTHORIZED',
        });
    }

    const ownerTelegramId = getOwnerTelegramId();
    if (!ownerTelegramId) {
        return res.status(503).json({
            error: 'Owner is not configured',
            code: 'OWNER_NOT_CONFIGURED',
        });
    }

    if (String(req.authUser.telegramId) !== ownerTelegramId) {
        return res.status(403).json({
            error: 'Owner access required',
            code: 'FORBIDDEN',
        });
    }

    return next();
}
