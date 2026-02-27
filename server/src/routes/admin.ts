import { Router } from 'express';

import { prisma } from '../lib/db/prisma';
import { requireAdmin, getAdminTelegramIds } from '../middleware/admin';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrfProtection';
import { strictLimit } from '../middleware/rateLimit';

const router = Router();

const CONFIRM_DELETE_ALL_NFTS = 'DELETE ALL NFTS';
const CONFIRM_DELETE_ALL_USERS = 'DELETE ALL USERS';

function normalizeConfirmValue(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim().toUpperCase();
}

router.get('/db/stats', requireAuth, requireAdmin, async (_req, res) => {
    try {
        const adminTelegramIds = getAdminTelegramIds();

        const [nftCount, userCount, adminUsers] = await Promise.all([
            prisma.nft.count(),
            prisma.user.count(),
            prisma.user.count({
                where: {
                    telegramId: {
                        in: adminTelegramIds,
                    },
                },
            }),
        ]);

        return res.json({
            success: true,
            stats: {
                nftCount,
                userCount,
                adminUsers,
            },
        });
    } catch (error) {
        console.error('Error fetching DB admin stats:', error);
        return res.status(500).json({
            error: 'Failed to fetch DB stats',
            code: 'DB_STATS_FAILED',
        });
    }
});

router.post('/db/purge-nfts', strictLimit, requireAuth, requireAdmin, csrfProtection, async (req, res) => {
    try {
        const confirmation = normalizeConfirmValue(req.body?.confirmation);
        if (confirmation !== CONFIRM_DELETE_ALL_NFTS) {
            return res.status(400).json({
                error: 'Invalid confirmation phrase',
                code: 'INVALID_CONFIRMATION',
                required: CONFIRM_DELETE_ALL_NFTS,
            });
        }

        const deletionResult = await prisma.$transaction(async (tx) => {
            const deletedTransactions = await tx.transaction.deleteMany({
                where: {
                    tokenId: {
                        not: null,
                    },
                },
            });

            const deletedHistory = await tx.nftHistory.deleteMany({});
            const deletedNfts = await tx.nft.deleteMany({});

            return {
                deletedNfts: deletedNfts.count,
                deletedHistory: deletedHistory.count,
                deletedTransactions: deletedTransactions.count,
            };
        });

        return res.json({
            success: true,
            message: 'All NFTs deleted',
            ...deletionResult,
        });
    } catch (error) {
        console.error('Error purging NFTs:', error);
        return res.status(500).json({
            error: 'Failed to delete all NFTs',
            code: 'PURGE_NFTS_FAILED',
        });
    }
});

router.post('/db/purge-users', strictLimit, requireAuth, requireAdmin, csrfProtection, async (req, res) => {
    try {
        const confirmation = normalizeConfirmValue(req.body?.confirmation);
        if (confirmation !== CONFIRM_DELETE_ALL_USERS) {
            return res.status(400).json({
                error: 'Invalid confirmation phrase',
                code: 'INVALID_CONFIRMATION',
                required: CONFIRM_DELETE_ALL_USERS,
            });
        }

        const adminTelegramIds = getAdminTelegramIds();
        const protectedUsers = await prisma.user.findMany({
            where: {
                telegramId: {
                    in: adminTelegramIds,
                },
            },
            select: {
                id: true,
            },
        });

        const protectedIds = new Set<string>(protectedUsers.map((user) => user.id));
        if (req.authUser?.uid) {
            protectedIds.add(req.authUser.uid);
        }

        const usersToDelete = await prisma.user.findMany({
            where: {
                id: {
                    notIn: Array.from(protectedIds),
                },
            },
            select: {
                id: true,
            },
        });

        const userIdsToDelete = usersToDelete.map((user) => user.id);

        if (userIdsToDelete.length === 0) {
            return res.json({
                success: true,
                deletedUsers: 0,
                deletedWallets: 0,
                resetQrClaims: 0,
            });
        }

        const result = await prisma.$transaction(async (tx) => {
            const resetQrClaims = await tx.qrCode.updateMany({
                where: {
                    usedBy: {
                        in: userIdsToDelete,
                    },
                },
                data: {
                    usedBy: null,
                    usedByName: null,
                    usedByPhoto: null,
                    usedByFirstName: null,
                },
            });

            const deletedWallets = await tx.wallet.deleteMany({
                where: {
                    userId: {
                        in: userIdsToDelete,
                    },
                },
            });

            const deletedUsers = await tx.user.deleteMany({
                where: {
                    id: {
                        in: userIdsToDelete,
                    },
                },
            });

            return {
                deletedUsers: deletedUsers.count,
                deletedWallets: deletedWallets.count,
                resetQrClaims: resetQrClaims.count,
            };
        });

        return res.json({
            success: true,
            ...result,
        });
    } catch (error) {
        console.error('Error purging users:', error);
        return res.status(500).json({
            error: 'Failed to delete users',
            code: 'PURGE_USERS_FAILED',
        });
    }
});

export default router;
