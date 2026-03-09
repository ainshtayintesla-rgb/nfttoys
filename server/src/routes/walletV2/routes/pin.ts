import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { prisma } from '../../../lib/db/prisma';
import { generateSalt, hashIpAddress, hashSecret, isValidPin, verifySecret } from '../../../lib/walletV2/security';
import { strictLimit } from '../../../middleware/rateLimit';
import { requireWalletV2Auth } from '../../../middleware/walletV2Auth';
import { PIN_VERIFY_LOCKOUT_WINDOW_MS, PIN_VERIFY_MAX_FAILURES } from '../constants';
import { ipFromRequest } from '../helpers/authDevice';
import { now, sendError } from '../helpers/utils';
import { applyGlobalPinToUserWallets, createAuditEvent, getLatestGlobalPinRecord } from '../helpers/walletDb';

const router = Router();

router.post('/wallet/:id/pin/verify', strictLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const walletId = req.params.id;
        const userId = req.walletV2Auth?.userId || null;
        const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
        const ipHash = hashIpAddress(ipFromRequest(req)) || null;
        const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

        if (walletId !== req.walletV2Auth!.walletId) {
            return sendError(res, 403, 'FORBIDDEN', 'Wallet access denied');
        }

        if (!isValidPin(pin)) {
            return sendError(res, 400, 'INVALID_PIN', 'PIN format is invalid');
        }

        const [wallet, globalPinRecord] = await Promise.all([
            prisma.walletV2.findUnique({
                where: { id: walletId },
                select: {
                    id: true,
                    status: true,
                },
            }),
            getLatestGlobalPinRecord(prisma, {
                userId,
                walletId,
            }),
        ]);

        if (!wallet) {
            return sendError(res, 404, 'WALLET_NOT_FOUND', 'Wallet not found');
        }

        if (wallet.status !== 'active') {
            return sendError(res, 423, 'WALLET_BLOCKED', 'Wallet is blocked');
        }

        if (!globalPinRecord) {
            return sendError(res, 404, 'WALLET_NOT_FOUND', 'Wallet not found');
        }

        const lockoutWindowStart = new Date(Date.now() - PIN_VERIFY_LOCKOUT_WINDOW_MS);
        const failureCountResult = await prisma.$queryRaw<[{ count: bigint }]>(
            Prisma.sql`
                SELECT COUNT(*) AS count
                FROM audit_events_v2
                WHERE event = 'wallet.pin.verify.failed'
                  AND wallet_id = ${walletId}
                  AND created_at >= ${lockoutWindowStart}
            `,
        );

        const recentFailures = Number(failureCountResult[0]?.count ?? 0n);

        if (recentFailures >= PIN_VERIFY_MAX_FAILURES) {
            return sendError(res, 429, 'PIN_LOCKED', 'Too many failed PIN attempts. Try again later.');
        }

        const pinValid = await verifySecret(globalPinRecord.pinHash, pin, globalPinRecord.pinSalt);

        if (!pinValid) {
            await createAuditEvent({
                walletId,
                userId,
                event: 'wallet.pin.verify.failed',
                ipHash,
                userAgent,
            });
            return sendError(res, 401, 'INVALID_PIN', 'PIN is invalid');
        }

        return res.json({
            success: true,
            data: {
                valid: true,
            },
        });
    } catch (error) {
        console.error('Wallet v2 pin verify error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to verify PIN');
    }
});

router.post('/wallet/:id/pin/change', strictLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const walletId = req.params.id;
        const authUserId = req.walletV2Auth?.userId || null;
        const currentPin = typeof req.body?.currentPin === 'string' ? req.body.currentPin.trim() : '';
        const newPin = typeof req.body?.newPin === 'string' ? req.body.newPin.trim() : '';

        if (walletId !== req.walletV2Auth!.walletId) {
            return sendError(res, 403, 'FORBIDDEN', 'Wallet access denied');
        }

        if (!isValidPin(currentPin)) {
            return sendError(res, 400, 'CURRENT_PIN_REQUIRED', 'Current PIN is required');
        }

        if (!isValidPin(newPin)) {
            return sendError(res, 400, 'INVALID_PIN', 'New PIN format is invalid');
        }

        const wallet = await prisma.walletV2.findUnique({
            where: { id: walletId },
            select: {
                id: true,
                status: true,
                userId: true,
            },
        });

        if (!wallet) {
            return sendError(res, 404, 'WALLET_NOT_FOUND', 'Wallet not found');
        }

        if (wallet.status !== 'active') {
            return sendError(res, 423, 'WALLET_BLOCKED', 'Wallet is blocked');
        }

        const pinOwnerUserId = authUserId || wallet.userId;

        if (!pinOwnerUserId) {
            return sendError(res, 401, 'UNAUTHORIZED', 'Authorization token is required');
        }

        const globalPinRecord = await getLatestGlobalPinRecord(prisma, {
            userId: pinOwnerUserId,
            walletId,
        });

        if (!globalPinRecord) {
            return sendError(res, 404, 'WALLET_NOT_FOUND', 'Wallet not found');
        }

        const currentPinValid = await verifySecret(globalPinRecord.pinHash, currentPin, globalPinRecord.pinSalt);
        if (!currentPinValid) {
            return sendError(res, 401, 'INVALID_CURRENT_PIN', 'Current PIN is incorrect');
        }

        const currentTime = now();
        const pinSalt = generateSalt();
        const pinHash = await hashSecret(newPin, pinSalt);
        const ipHash = hashIpAddress(ipFromRequest(req)) || null;
        const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

        await prisma.$transaction(async (tx) => {
            await applyGlobalPinToUserWallets(
                tx,
                pinOwnerUserId,
                pinHash,
                pinSalt,
                currentTime,
            );
        });

        await createAuditEvent({
            walletId,
            userId: pinOwnerUserId,
            event: 'wallet.pin.changed',
            ipHash,
            userAgent,
            meta: {
                sessionId: req.walletV2Auth?.sessionId,
                deviceId: req.walletV2Auth?.deviceId,
            },
        });

        return res.json({
            success: true,
            data: {
                walletId,
                pinUpdatedAt: currentTime.toISOString(),
            },
        });
    } catch (error) {
        console.error('Wallet v2 pin change error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to change PIN');
    }
});

export default router;
