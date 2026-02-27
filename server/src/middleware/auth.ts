import { NextFunction, Request, Response } from 'express';
import { JwtAuthPayload, verifyAuthToken } from '../lib/auth/jwt';
import { validateTelegramInitData } from '../lib/utils/telegramValidation';

declare global {
    namespace Express {
        interface Request {
            authUser?: JwtAuthPayload;
        }
    }
}

function extractBearerToken(authorization?: string): string | null {
    if (!authorization) return null;

    const [scheme, token] = authorization.trim().split(/\s+/, 2);
    if (!scheme || !token) return null;
    if (scheme.toLowerCase() !== 'bearer') return null;
    return token;
}

function extractInitData(req: Request): string | null {
    const bodyInitData = typeof req.body?.initData === 'string'
        ? req.body.initData.trim()
        : '';

    if (bodyInitData) {
        return bodyInitData;
    }

    const queryInitData = req.query?.initData;
    if (typeof queryInitData === 'string' && queryInitData.trim()) {
        return queryInitData.trim();
    }

    if (Array.isArray(queryInitData)) {
        const firstValid = queryInitData.find((item) => typeof item === 'string' && item.trim());
        if (typeof firstValid === 'string') {
            return firstValid.trim();
        }
    }

    const headerInitData = req.headers['x-telegram-init-data'];
    if (typeof headerInitData === 'string' && headerInitData.trim()) {
        return headerInitData.trim();
    }

    if (Array.isArray(headerInitData)) {
        const firstValid = headerInitData.find((item) => typeof item === 'string' && item.trim());
        if (typeof firstValid === 'string') {
            return firstValid.trim();
        }
    }

    return null;
}

function extractInitDataAuth(req: Request): JwtAuthPayload | null {
    const initData = extractInitData(req);
    if (!initData) {
        return null;
    }

    const validation = validateTelegramInitData(initData);
    if (!validation.valid || !validation.user || typeof validation.user.id !== 'number') {
        return null;
    }

    const user = validation.user;

    return {
        uid: `telegram_${user.id}`,
        telegramId: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
    };
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
    const token = extractBearerToken(req.headers.authorization);

    if (token) {
        const payload = verifyAuthToken(token);
        req.authUser = payload || undefined;

        if (payload) {
            return next();
        }
    }

    const initDataPayload = extractInitDataAuth(req);
    req.authUser = initDataPayload || undefined;
    return next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const token = extractBearerToken(req.headers.authorization);

    if (token) {
        const payload = verifyAuthToken(token);

        if (payload) {
            req.authUser = payload;
            return next();
        }
    }

    const initDataPayload = extractInitDataAuth(req);

    if (initDataPayload) {
        req.authUser = initDataPayload;
        return next();
    }

    return res.status(401).json({
        error: 'Authorization token is required',
        code: 'UNAUTHORIZED',
    });
}
