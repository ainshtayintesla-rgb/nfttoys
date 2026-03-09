import { Router } from 'express';

import { walletV2AccessTokenTtlSec, signWalletV2AccessToken } from '../../../lib/auth/walletV2Jwt';
import { prisma } from '../../../lib/db/prisma';
import { generateOpaqueRefreshToken, hashIpAddress, hashRefreshToken } from '../../../lib/walletV2/security';
import { standardLimit } from '../../../middleware/rateLimit';
import { requireWalletV2Auth } from '../../../middleware/walletV2Auth';
import {
    walletV2SessionLogoutLimit,
    walletV2SessionRefreshLimit,
    walletV2SessionsRevokeLimit,
} from '../../../middleware/walletV2RateLimit';
import { REFRESH_TOKEN_TTL_SEC } from '../constants';
import { ipFromRequest } from '../helpers/authDevice';
import { now, sendError } from '../helpers/utils';
import { createAuditEvent } from '../helpers/walletDb';
import { DevicePlatform } from '../types';

const router = Router();

router.post('/session/refresh', walletV2SessionRefreshLimit, async (req, res) => {
    try {
        const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken.trim() : '';
        const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';

        if (!refreshToken) {
            return sendError(res, 401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
        }

        if (!deviceId) {
            return sendError(res, 400, 'DEVICE_MISMATCH', 'deviceId is required');
        }

        const refreshTokenHashValue = hashRefreshToken(refreshToken);

        const session = await prisma.walletSessionV2.findFirst({
            where: { refreshTokenHash: refreshTokenHashValue },
            select: {
                id: true,
                walletId: true,
                userId: true,
                deviceId: true,
                platform: true,
                status: true,
                refreshTokenExpiresAt: true,
                wallet: {
                    select: {
                        status: true,
                    },
                },
            },
        });

        if (!session) {
            return sendError(res, 401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
        }

        if (session.deviceId !== deviceId) {
            return sendError(res, 409, 'DEVICE_MISMATCH', 'Device does not match session');
        }

        if (session.status !== 'active' || session.refreshTokenExpiresAt.getTime() <= Date.now()) {
            return sendError(res, 423, 'SESSION_REVOKED', 'Session is revoked or expired');
        }

        if (session.wallet.status === 'blocked') {
            return sendError(res, 423, 'WALLET_BLOCKED', 'Wallet is blocked');
        }

        const currentTime = now();
        const newRefreshToken = generateOpaqueRefreshToken();
        const newRefreshTokenHash = hashRefreshToken(newRefreshToken);
        const newRefreshExpiresAt = new Date(currentTime.getTime() + REFRESH_TOKEN_TTL_SEC * 1000);
        const ipHash = hashIpAddress(ipFromRequest(req)) || null;
        const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

        await prisma.walletSessionV2.update({
            where: { id: session.id },
            data: {
                refreshTokenHash: newRefreshTokenHash,
                refreshTokenExpiresAt: newRefreshExpiresAt,
                lastSeenAt: currentTime,
                lastIpHash: ipHash,
                userAgent,
            },
        });

        const accessToken = signWalletV2AccessToken({
            sid: session.id,
            wid: session.walletId,
            uid: session.userId || undefined,
            did: session.deviceId,
            platform: session.platform as DevicePlatform,
        });

        await createAuditEvent({
            walletId: session.walletId,
            userId: session.userId,
            event: 'session.refreshed',
            ipHash,
            userAgent,
            meta: {
                sessionId: session.id,
                deviceId: session.deviceId,
            },
        });

        return res.json({
            success: true,
            data: {
                session: {
                    accessToken,
                    refreshToken: newRefreshToken,
                    expiresInSec: walletV2AccessTokenTtlSec(),
                },
            },
        });
    } catch (error) {
        console.error('Wallet v2 session refresh error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to refresh session');
    }
});

router.post('/session/logout', walletV2SessionLogoutLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken.trim() : '';

        if (!refreshToken) {
            return sendError(res, 401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
        }

        const sessionId = req.walletV2Auth!.sessionId;
        const session = await prisma.walletSessionV2.findUnique({
            where: { id: sessionId },
            select: {
                id: true,
                walletId: true,
                userId: true,
                refreshTokenHash: true,
                status: true,
                deviceId: true,
            },
        });

        if (!session) {
            return sendError(res, 401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
        }

        if (session.refreshTokenHash !== hashRefreshToken(refreshToken)) {
            return sendError(res, 401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
        }

        if (session.status === 'active') {
            await prisma.walletSessionV2.update({
                where: { id: session.id },
                data: {
                    status: 'revoked',
                    revokedAt: now(),
                    revokedReason: 'logout',
                },
            });
        }

        await createAuditEvent({
            walletId: session.walletId,
            userId: session.userId,
            event: 'session.revoked',
            ipHash: hashIpAddress(ipFromRequest(req)) || null,
            userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
            meta: {
                sessionId: session.id,
                reason: 'logout',
                deviceId: session.deviceId,
            },
        });

        return res.json({
            success: true,
            data: {
                revoked: true,
            },
        });
    } catch (error) {
        console.error('Wallet v2 session logout error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to revoke session');
    }
});

router.get('/sessions', standardLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const walletId = req.walletV2Auth!.walletId;
        const currentSessionId = req.walletV2Auth!.sessionId;

        const sessions = await prisma.walletSessionV2.findMany({
            where: { walletId },
            orderBy: [
                { status: 'asc' },
                { createdAt: 'desc' },
            ],
            take: 30,
            select: {
                id: true,
                deviceId: true,
                platform: true,
                biometricSupported: true,
                status: true,
                createdAt: true,
                lastSeenAt: true,
            },
        });

        return res.json({
            success: true,
            data: {
                sessions: sessions.map((session) => ({
                    id: session.id,
                    deviceId: session.deviceId,
                    platform: session.platform,
                    biometricSupported: session.biometricSupported,
                    status: session.status,
                    createdAt: session.createdAt.toISOString(),
                    lastSeenAt: session.lastSeenAt.toISOString(),
                    isCurrent: session.id === currentSessionId,
                })),
            },
        });
    } catch (error) {
        console.error('Wallet v2 sessions list error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch sessions');
    }
});

router.post('/sessions/revoke', walletV2SessionsRevokeLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const targetSessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
        const walletId = req.walletV2Auth!.walletId;
        const currentSessionId = req.walletV2Auth!.sessionId;

        if (!targetSessionId) {
            return sendError(res, 400, 'SESSION_ID_REQUIRED', 'sessionId is required');
        }

        if (targetSessionId === currentSessionId) {
            return sendError(res, 400, 'SELF_REVOKE_NOT_ALLOWED', 'Use /v2/session/logout to revoke current session');
        }

        const revokeResult = await prisma.walletSessionV2.updateMany({
            where: {
                id: targetSessionId,
                walletId,
                status: 'active',
            },
            data: {
                status: 'revoked',
                revokedAt: now(),
                revokedReason: 'manual_revoke',
            },
        });

        if (revokeResult.count !== 1) {
            return sendError(res, 404, 'SESSION_NOT_FOUND', 'Session not found');
        }

        await createAuditEvent({
            walletId,
            userId: req.walletV2Auth?.userId,
            event: 'session.revoked',
            ipHash: hashIpAddress(ipFromRequest(req)) || null,
            userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
            meta: {
                sessionId: targetSessionId,
                reason: 'manual_revoke',
            },
        });

        return res.json({
            success: true,
            data: {
                revoked: true,
            },
        });
    } catch (error) {
        console.error('Wallet v2 session revoke error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to revoke session');
    }
});

export default router;
