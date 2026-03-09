import type { CookieOptions, Request, Response } from 'express';

export const AUTH_COOKIE_NAME = 'nfttoys_auth';

const AUTH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function isSecureRequest(req?: Request): boolean {
    if (!req) {
        return process.env.NODE_ENV === 'production' || process.env.RUN_MODE === 'production';
    }

    if (req.secure) {
        return true;
    }

    const forwardedProto = req.headers['x-forwarded-proto'];
    if (typeof forwardedProto === 'string') {
        return forwardedProto.split(',')[0]?.trim() === 'https';
    }

    return process.env.NODE_ENV === 'production' || process.env.RUN_MODE === 'production';
}

function getCookieDomain(): string | undefined {
    const domain = (process.env.AUTH_COOKIE_DOMAIN || '').trim();
    return domain || undefined;
}

function getAuthCookieOptions(req?: Request): CookieOptions {
    const domain = getCookieDomain();

    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecureRequest(req),
        maxAge: AUTH_COOKIE_MAX_AGE_MS,
        path: '/',
        ...(domain ? { domain } : {}),
    };
}

export function setAuthCookie(res: Response, token: string, req?: Request) {
    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(req));
}

export function extractAuthCookieToken(cookieHeader?: string): string | null {
    if (!cookieHeader) {
        return null;
    }

    const cookies = cookieHeader.split(';');

    for (const cookie of cookies) {
        const [name, ...valueParts] = cookie.split('=');
        if (name?.trim() !== AUTH_COOKIE_NAME) {
            continue;
        }

        const rawValue = valueParts.join('=').trim();
        if (!rawValue) {
            return null;
        }

        try {
            return decodeURIComponent(rawValue);
        } catch {
            return rawValue;
        }
    }

    return null;
}
