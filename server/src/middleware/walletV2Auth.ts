import { NextFunction, Request, Response } from 'express';

import { prisma } from '../lib/db/prisma';
import { verifyWalletV2AccessToken } from '../lib/auth/walletV2Jwt';

export interface WalletV2AuthContext {
    sessionId: string;
    walletId: string;
    userId: string | null;
    deviceId: string;
    platform: 'ios' | 'android' | 'web';
}

declare global {
    namespace Express {
        interface Request {
            walletV2Auth?: WalletV2AuthContext;
        }
    }
}

function extractBearerToken(authorization?: string): string | null {
    if (!authorization) {
        return null;
    }

    const [scheme, token] = authorization.trim().split(/\s+/, 2);

    if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
        return null;
    }

    return token;
}

export async function requireWalletV2Auth(req: Request, res: Response, next: NextFunction) {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'UNAUTHORIZED',
                message: 'Authorization token is required',
            },
        });
    }

    const payload = verifyWalletV2AccessToken(token);

    if (!payload) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'UNAUTHORIZED',
                message: 'Invalid access token',
            },
        });
    }

    const session = await prisma.walletSessionV2.findUnique({
        where: { id: payload.sid },
        select: {
            id: true,
            walletId: true,
            userId: true,
            deviceId: true,
            platform: true,
            status: true,
            refreshTokenExpiresAt: true,
        },
    });

    if (!session || session.walletId !== payload.wid || session.deviceId !== payload.did) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'UNAUTHORIZED',
                message: 'Invalid session',
            },
        });
    }

    if (session.status !== 'active' || session.refreshTokenExpiresAt.getTime() <= Date.now()) {
        return res.status(423).json({
            success: false,
            error: {
                code: 'SESSION_REVOKED',
                message: 'Session is revoked or expired',
            },
        });
    }

    req.walletV2Auth = {
        sessionId: session.id,
        walletId: session.walletId,
        userId: session.userId,
        deviceId: session.deviceId,
        platform: session.platform as WalletV2AuthContext['platform'],
    };

    return next();
}
