import rateLimit from 'express-rate-limit';
import { Request } from 'express';

function errorMessage(code: string, message: string) {
    return {
        success: false,
        error: {
            code,
            message,
        },
    };
}

function reqIp(req: Request): string {
    return req.ip || req.socket.remoteAddress || 'unknown';
}

export const walletV2ImportLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    keyGenerator: (req) => {
        const deviceId = typeof req.body?.device?.deviceId === 'string' ? req.body.device.deviceId.trim() : 'unknown-device';
        return `${reqIp(req)}:${deviceId}`;
    },
    message: errorMessage('IMPORT_RATE_LIMITED', 'Too many import attempts'),
    standardHeaders: true,
    legacyHeaders: false,
});

export const walletV2SessionRefreshLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => {
        const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '';
        const suffix = refreshToken ? refreshToken.slice(-16) : 'missing';
        return `${reqIp(req)}:${suffix}`;
    },
    message: errorMessage('RATE_LIMITED', 'Too many refresh requests'),
    standardHeaders: true,
    legacyHeaders: false,
});

export const walletV2SessionLogoutLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 20,
    keyGenerator: (req) => req.walletV2Auth?.sessionId || reqIp(req),
    message: errorMessage('RATE_LIMITED', 'Too many logout requests'),
    standardHeaders: true,
    legacyHeaders: false,
});

export const walletV2SessionsRevokeLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 20,
    keyGenerator: (req) => req.walletV2Auth?.walletId || reqIp(req),
    message: errorMessage('RATE_LIMITED', 'Too many revoke requests'),
    standardHeaders: true,
    legacyHeaders: false,
});
