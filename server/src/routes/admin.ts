import { Router, Response } from 'express';

import { prisma } from '../lib/db/prisma';
import { getUpdateService, UpdateServiceError } from '../lib/updateService';
import { TREASURY_ADDRESS, TREASURY_FRIENDLY_ADDRESS } from '../lib/utils/crypto';
import { requireAdmin, getAdminTelegramIds } from '../middleware/admin';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrfProtection';
import { strictLimit, standardLimit } from '../middleware/rateLimit';

const router = Router();

const CONFIRM_DELETE_ALL_NFTS = 'DELETE ALL NFTS';
const CONFIRM_DELETE_ALL_USERS = 'DELETE ALL USERS';
const MAX_WALLET_OPERATION_AMOUNT = 10_000_000_000;

function normalizeConfirmValue(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim().toUpperCase();
}

function normalizeLookupUserId(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }

    if (/^\d+$/.test(trimmed)) {
        return `telegram_${trimmed}`;
    }

    const prefixedMatch = /^(?:telegram|tg)_(\d+)$/i.exec(trimmed);
    if (!prefixedMatch?.[1]) {
        return '';
    }

    return `telegram_${prefixedMatch[1]}`;
}

function parseOperationAmount(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value)) {
        return value > 0 ? value : null;
    }

    if (typeof value === 'string') {
        const normalized = value.trim();
        if (!normalized) {
            return null;
        }

        const parsed = Number.parseInt(normalized, 10);
        if (!Number.isNaN(parsed) && String(parsed) === normalized) {
            return parsed > 0 ? parsed : null;
        }
    }

    return null;
}

function adminLookupUserPayload(user: {
    id: string;
    telegramId: string | null;
    username: string | null;
    firstName: string | null;
    photoUrl: string | null;
}, wallet: {
    address: string;
    friendlyAddress: string;
    balance: number;
    createdAt: Date;
} | null, nftCount: number) {
    return {
        id: user.id,
        telegramId: user.telegramId,
        username: user.username,
        firstName: user.firstName,
        photoUrl: user.photoUrl,
        wallet: wallet
            ? {
                address: wallet.address,
                friendlyAddress: wallet.friendlyAddress,
                balance: wallet.balance,
                nftCount,
                createdAt: wallet.createdAt ? wallet.createdAt.toISOString() : null,
            }
            : null,
    };
}

function handleUpdateRouteError(res: Response, error: unknown, fallbackCode: string) {
    if (error instanceof UpdateServiceError) {
        return res.status(error.status).json({
            error: error.message,
            code: error.code,
        });
    }

    console.error('Admin update route error:', error);
    const message = error instanceof Error ? error.message : 'Update operation failed';

    return res.status(500).json({
        error: message,
        code: fallbackCode,
    });
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

router.get('/users/lookup', standardLimit, requireAuth, requireAdmin, async (req, res) => {
    try {
        const lookupUserId = normalizeLookupUserId(req.query.userId);

        if (!lookupUserId) {
            return res.json({ success: true, user: null });
        }

        const user = await prisma.user.findUnique({
            where: { id: lookupUserId },
            select: {
                id: true,
                telegramId: true,
                username: true,
                firstName: true,
                photoUrl: true,
                walletAddress: true,
            },
        });

        if (!user) {
            return res.json({ success: true, user: null });
        }

        if (!user.walletAddress) {
            return res.json({
                success: true,
                user: adminLookupUserPayload(user, null, 0),
            });
        }

        const wallet = await prisma.wallet.findUnique({
            where: { address: user.walletAddress },
            select: {
                address: true,
                friendlyAddress: true,
                balance: true,
                createdAt: true,
            },
        });

        if (!wallet) {
            return res.json({
                success: true,
                user: adminLookupUserPayload(user, null, 0),
            });
        }

        const nftCount = await prisma.nft.count({ where: { ownerWallet: wallet.address } });

        return res.json({
            success: true,
            user: adminLookupUserPayload(user, wallet, nftCount),
        });
    } catch (error) {
        console.error('Admin user lookup error:', error);
        return res.status(500).json({
            error: 'Failed to lookup user',
            code: 'ADMIN_LOOKUP_FAILED',
        });
    }
});

router.post('/wallet/topup', strictLimit, requireAuth, requireAdmin, csrfProtection, async (req, res) => {
    try {
        const lookupUserId = normalizeLookupUserId(req.body?.userId);
        const amount = parseOperationAmount(req.body?.amount);

        if (!lookupUserId) {
            return res.status(400).json({
                error: 'Invalid userId',
                code: 'INVALID_USER_ID',
            });
        }

        if (!amount) {
            return res.status(400).json({
                error: 'Invalid amount',
                code: 'INVALID_AMOUNT',
            });
        }

        if (amount > MAX_WALLET_OPERATION_AMOUNT) {
            return res.status(400).json({
                error: `Amount must be <= ${MAX_WALLET_OPERATION_AMOUNT}`,
                code: 'AMOUNT_TOO_LARGE',
            });
        }

        const result = await prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({
                where: { id: lookupUserId },
                select: {
                    id: true,
                    telegramId: true,
                    username: true,
                    firstName: true,
                    photoUrl: true,
                    walletAddress: true,
                },
            });

            if (!user) {
                return { error: 'NOT_FOUND' } as const;
            }

            if (!user.walletAddress) {
                return { error: 'NO_WALLET' } as const;
            }

            const wallet = await tx.wallet.findUnique({
                where: { address: user.walletAddress },
                select: {
                    address: true,
                    friendlyAddress: true,
                    balance: true,
                    createdAt: true,
                },
            });

            if (!wallet) {
                return { error: 'WALLET_NOT_FOUND' } as const;
            }

            const updatedWallet = await tx.wallet.update({
                where: { address: wallet.address },
                data: {
                    balance: { increment: amount },
                },
                select: {
                    address: true,
                    friendlyAddress: true,
                    balance: true,
                    createdAt: true,
                },
            });

            const operation = await tx.walletTransaction.create({
                data: {
                    walletAddress: wallet.address,
                    userId: lookupUserId,
                    type: 'topup',
                    amount,
                    currency: 'UZS',
                    status: 'completed',
                    fromAddress: TREASURY_ADDRESS,
                    fromFriendly: TREASURY_FRIENDLY_ADDRESS,
                    toAddress: wallet.address,
                    toFriendly: wallet.friendlyAddress,
                },
                select: {
                    id: true,
                    type: true,
                    amount: true,
                    currency: true,
                    status: true,
                    fromAddress: true,
                    fromFriendly: true,
                    toAddress: true,
                    toFriendly: true,
                    memo: true,
                    feeAmount: true,
                    feeCurrency: true,
                    createdAt: true,
                },
            });

            const nftCount = await tx.nft.count({ where: { ownerWallet: updatedWallet.address } });

            return {
                user,
                wallet: updatedWallet,
                operation,
                nftCount,
            } as const;
        });

        if ('error' in result) {
            if (result.error === 'NOT_FOUND') {
                return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
            }

            if (result.error === 'NO_WALLET') {
                return res.status(404).json({ error: 'User has no wallet', code: 'NO_WALLET' });
            }

            return res.status(404).json({ error: 'Wallet not found', code: 'WALLET_NOT_FOUND' });
        }

        return res.json({
            success: true,
            user: adminLookupUserPayload(result.user, result.wallet, result.nftCount),
            wallet: {
                address: result.wallet.address,
                friendlyAddress: result.wallet.friendlyAddress,
                nftCount: result.nftCount,
                balance: result.wallet.balance,
                createdAt: result.wallet.createdAt ? result.wallet.createdAt.toISOString() : null,
            },
            operation: {
                id: result.operation.id,
                type: result.operation.type,
                amount: result.operation.amount,
                currency: result.operation.currency,
                status: result.operation.status,
                fromAddress: result.operation.fromAddress,
                fromFriendly: result.operation.fromFriendly,
                toAddress: result.operation.toAddress,
                toFriendly: result.operation.toFriendly,
                memo: result.operation.memo,
                feeAmount: result.operation.feeAmount,
                feeCurrency: result.operation.feeCurrency,
                createdAt: result.operation.createdAt.toISOString(),
            },
        });
    } catch (error) {
        console.error('Admin wallet topup error:', error);
        return res.status(500).json({
            error: 'Failed to top up wallet',
            code: 'ADMIN_TOPUP_FAILED',
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

router.get('/updates/status', requireAuth, requireAdmin, async (_req, res) => {
    try {
        const status = await getUpdateService().getStatus();
        return res.json({
            success: true,
            ...status,
        });
    } catch (error) {
        return handleUpdateRouteError(res, error, 'UPDATES_STATUS_FAILED');
    }
});

router.post('/updates/check', strictLimit, requireAuth, requireAdmin, csrfProtection, async (_req, res) => {
    try {
        const status = await getUpdateService().checkForUpdates('manual');
        return res.json({
            success: true,
            ...status,
        });
    } catch (error) {
        return handleUpdateRouteError(res, error, 'UPDATES_CHECK_FAILED');
    }
});

router.post('/updates/apply', strictLimit, requireAuth, requireAdmin, csrfProtection, async (_req, res) => {
    try {
        const status = await getUpdateService().applyUpdate('manual');
        return res.json({
            success: true,
            ...status,
        });
    } catch (error) {
        return handleUpdateRouteError(res, error, 'UPDATES_APPLY_FAILED');
    }
});

router.post('/updates/settings', strictLimit, requireAuth, requireAdmin, csrfProtection, async (req, res) => {
    try {
        const status = await getUpdateService().updateSettings({
            intervalMinutes: req.body?.intervalMinutes,
            autoUpdateEnabled: req.body?.autoUpdateEnabled,
        });

        return res.json({
            success: true,
            ...status,
        });
    } catch (error) {
        return handleUpdateRouteError(res, error, 'UPDATES_SETTINGS_FAILED');
    }
});

export default router;
