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

type AuthSource = 'bearer' | 'cookie' | 'init-data';

interface ResolvedAuthPayload {
    payload: JwtAuthPayload;
    source: AuthSource;
}

function extractRequestToken(req: Request): { token: string; source: AuthSource } | null {
    const bearerToken = extractBearerToken(req.headers.authorization);
    if (bearerToken) {
        return {
            token: bearerToken,
            source: 'bearer',
        };
    }

    const cookieToken = extractAuthCookieToken(req.headers.cookie);
    if (cookieToken) {
        return {
            token: cookieToken,
            source: 'cookie',
        };
    }

    return null;
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

function resolveAuthPayload(req: Request): ResolvedAuthPayload | null {
    const token = extractRequestToken(req);
    if (token) {
        const payload = verifyAuthToken(token.token);
        if (payload) {
            return {
                payload,
                source: token.source,
            };
        }
    }

    const initDataPayload = extractInitDataAuth(req);
    if (!initDataPayload) {
        return null;
    }

    return {
        payload: initDataPayload,
        source: 'init-data',
    };
}

function syncAuthUserAndContinue(
    auth: ResolvedAuthPayload,
    res: Response,
    next: NextFunction,
    required: boolean,
) {
    // JWT/cookie-authenticated requests already passed through /auth/telegram.
    // Re-upserting the same user on every protected request creates row-lock storms
    // when the mini app loads multiple screens in parallel.
    if (auth.source !== 'init-data') {
        return next();
    }

    const authUser = auth.payload;

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
    const auth = resolveAuthPayload(req);
    req.authUser = auth?.payload;

    if (!auth) {
        return next();
    }

    return syncAuthUserAndContinue(auth, _res, next, false);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const auth = resolveAuthPayload(req);

    if (auth) {
        req.authUser = auth.payload;
        return syncAuthUserAndContinue(auth, res, next, true);
    }

    return res.status(401).json({
        error: 'Authorization token is required',
        code: 'UNAUTHORIZED',
    });
}
