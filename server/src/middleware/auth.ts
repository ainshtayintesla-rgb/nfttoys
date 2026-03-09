import { NextFunction, Request, Response } from 'express';
import { extractAuthCookieToken } from '../lib/auth/cookie';
import { JwtAuthPayload, verifyAuthToken } from '../lib/auth/jwt';
import { ensureAuthUserUpsert } from '../lib/auth/ensureAuthUserUpsert';
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

function extractRequestToken(req: Request): string | null {
    const bearerToken = extractBearerToken(req.headers.authorization);
    if (bearerToken) {
        return bearerToken;
    }

    return extractAuthCookieToken(req.headers.cookie);
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

function resolveAuthPayload(req: Request): JwtAuthPayload | null {
    const token = extractRequestToken(req);
    if (token) {
        const payload = verifyAuthToken(token);
        if (payload) {
            return payload;
        }
    }

    return extractInitDataAuth(req);
}

function syncAuthUserAndContinue(
    authUser: JwtAuthPayload,
    res: Response,
    next: NextFunction,
    required: boolean,
) {
    ensureAuthUserUpsert(authUser)
        .then(() => next())
        .catch((error) => {
            console.error('Auth user auto-upsert failed:', error);

            if (required) {
                return res.status(500).json({
                    error: 'Failed to sync authenticated user',
                    code: 'AUTH_SYNC_ERROR',
                });
            }

            return next();
        });
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
    const payload = resolveAuthPayload(req);
    req.authUser = payload || undefined;

    if (!payload) {
        return next();
    }

    return syncAuthUserAndContinue(payload, _res, next, false);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const payload = resolveAuthPayload(req);

    if (payload) {
        req.authUser = payload;
        return syncAuthUserAndContinue(payload, res, next, true);
    }

    return res.status(401).json({
        error: 'Authorization token is required',
        code: 'UNAUTHORIZED',
    });
}
