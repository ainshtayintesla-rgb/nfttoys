import { Router } from 'express';

import { prisma } from '../../../lib/db/prisma';
import { standardLimit } from '../../../middleware/rateLimit';
import { requireWalletV2Auth } from '../../../middleware/walletV2Auth';
import { classifyWalletV2Tx, formatWalletAddress, sendError, toIsoDate } from '../helpers/utils';

const router = Router();

router.get('/wallet/:id/balance', standardLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const walletId = req.params.id;

        if (walletId !== req.walletV2Auth!.walletId) {
            return sendError(res, 403, 'FORBIDDEN', 'Wallet access denied');
        }

        const [wallet, mainAddress, balances] = await Promise.all([
            prisma.walletV2.findUnique({
                where: { id: walletId },
                select: { id: true },
            }),
            prisma.addressV2.findFirst({
                where: {
                    walletId,
                    type: 'main',
                    status: 'active',
                },
                select: { address: true },
            }),
            prisma.balanceV2.findMany({
                where: { walletId },
                orderBy: { asset: 'asc' },
                select: {
                    asset: true,
                    available: true,
                    locked: true,
                    updatedAt: true,
                },
            }),
        ]);

        if (!wallet || !mainAddress?.address) {
            return sendError(res, 404, 'WALLET_NOT_FOUND', 'Wallet not found');
        }

        return res.json({
            success: true,
            data: {
                walletId,
                address: formatWalletAddress(mainAddress.address),
                balances: balances.map((balance) => ({
                    asset: balance.asset,
                    available: balance.available.toString(),
                    locked: balance.locked.toString(),
                    updatedAt: balance.updatedAt.toISOString(),
                })),
            },
        });
    } catch (error) {
        console.error('Wallet v2 balances error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch balances');
    }
});

router.get('/wallet/:id/transactions', standardLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const walletId = req.params.id;
        const limitRaw = typeof req.query.limit === 'string'
            ? Number.parseInt(req.query.limit, 10)
            : NaN;
        const limit = Number.isFinite(limitRaw)
            ? Math.min(200, Math.max(1, limitRaw))
            : 50;

        if (walletId !== req.walletV2Auth!.walletId) {
            return sendError(res, 403, 'FORBIDDEN', 'Wallet access denied');
        }

        const [wallet, mainAddress] = await Promise.all([
            prisma.walletV2.findUnique({
                where: { id: walletId },
                select: { id: true },
            }),
            prisma.addressV2.findFirst({
                where: {
                    walletId,
                    type: 'main',
                    status: 'active',
                },
                select: { address: true },
            }),
        ]);

        if (!wallet || !mainAddress?.address) {
            return sendError(res, 404, 'WALLET_NOT_FOUND', 'Wallet not found');
        }

        const ownAddress = mainAddress.address;
        const txRows = await prisma.txV2.findMany({
            where: {
                OR: [
                    { walletId },
                    { toAddress: ownAddress, status: 'completed' },
                ],
            },
            orderBy: [
                { createdAt: 'desc' },
                { id: 'desc' },
            ],
            take: limit,
            select: {
                id: true,
                walletId: true,
                fromAddress: true,
                toAddress: true,
                asset: true,
                amount: true,
                status: true,
                createdAt: true,
                completedAt: true,
                meta: true,
            },
        });

        return res.json({
            success: true,
            data: {
                walletId,
                address: formatWalletAddress(ownAddress),
                items: txRows.map((txRow) => {
                    const classification = classifyWalletV2Tx({
                        walletId,
                        ownAddress,
                        tx: {
                            walletId: txRow.walletId,
                            fromAddress: txRow.fromAddress,
                            toAddress: txRow.toAddress,
                            meta: txRow.meta,
                        },
                    });

                    return {
                        id: txRow.id,
                        type: classification.type,
                        direction: classification.direction,
                        fromAddress: formatWalletAddress(txRow.fromAddress),
                        toAddress: formatWalletAddress(txRow.toAddress),
                        asset: txRow.asset,
                        amount: txRow.amount.toString(),
                        status: txRow.status,
                        createdAt: txRow.createdAt.toISOString(),
                        completedAt: toIsoDate(txRow.completedAt),
                    };
                }),
            },
        });
    } catch (error) {
        console.error('Wallet v2 transactions error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch transactions');
    }
});

export default router;
