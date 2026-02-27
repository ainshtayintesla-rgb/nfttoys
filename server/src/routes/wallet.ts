import { Router } from 'express';

import { prisma } from '../lib/db/prisma';
import { parseTelegramId } from '../lib/db/utils';
import { generateWalletAddress, toFriendlyAddress } from '../lib/utils/crypto';
import { requireAuth } from '../middleware/auth';
import { authLimit, standardLimit } from '../middleware/rateLimit';

const router = Router();
const MAX_WALLET_OPERATION_AMOUNT = 10_000_000_000;
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 50;

type WalletOperationKind = 'topup' | 'withdraw';

function parseAmount(rawAmount: unknown): number | null {
    if (typeof rawAmount === 'number' && Number.isInteger(rawAmount)) {
        return rawAmount > 0 ? rawAmount : null;
    }

    if (typeof rawAmount === 'string') {
        const normalized = rawAmount.trim();
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

function parseHistoryLimit(rawLimit: unknown): number {
    if (typeof rawLimit !== 'string' || !rawLimit.trim()) {
        return DEFAULT_HISTORY_LIMIT;
    }

    const parsed = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return DEFAULT_HISTORY_LIMIT;
    }

    return Math.min(parsed, MAX_HISTORY_LIMIT);
}

function walletPayload(wallet: {
    address: string;
    friendlyAddress: string;
    balance: number;
    createdAt: Date;
}, nftCount: number) {
    return {
        address: wallet.address,
        friendlyAddress: wallet.friendlyAddress || toFriendlyAddress(wallet.address),
        nftCount,
        balance: wallet.balance || 0,
        createdAt: wallet.createdAt ? wallet.createdAt.toISOString() : null,
    };
}

function walletOperationPayload(operation: {
    id: string;
    type: string;
    amount: number;
    currency: string;
    status: string;
    createdAt: Date;
}) {
    return {
        id: operation.id,
        type: operation.type,
        amount: operation.amount,
        currency: operation.currency,
        status: operation.status,
        createdAt: operation.createdAt.toISOString(),
    };
}

async function applyWalletBalanceOperation(userId: string, amount: number, operation: WalletOperationKind) {
    return prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
            where: { id: userId },
            select: { walletAddress: true },
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

        if (operation === 'withdraw' && wallet.balance < amount) {
            return {
                error: 'INSUFFICIENT_BALANCE',
                currentBalance: wallet.balance,
            } as const;
        }

        const updatedWallet = await tx.wallet.update({
            where: { address: wallet.address },
            data: {
                balance: operation === 'topup'
                    ? { increment: amount }
                    : { decrement: amount },
            },
            select: {
                address: true,
                friendlyAddress: true,
                balance: true,
                createdAt: true,
            },
        });

        const operationRow = await tx.walletTransaction.create({
            data: {
                walletAddress: wallet.address,
                userId,
                type: operation,
                amount,
                currency: 'UZS',
                status: 'completed',
            },
            select: {
                id: true,
                type: true,
                amount: true,
                currency: true,
                status: true,
                createdAt: true,
            },
        });

        const nftCount = await tx.nft.count({ where: { ownerWallet: updatedWallet.address } });

        return {
            wallet: updatedWallet,
            nftCount,
            operation: operationRow,
        } as const;
    });
}

// POST /wallet/create
router.post('/create', authLimit, requireAuth, async (req, res) => {
    try {
        const userId = req.authUser!.uid;

        const existingUser = await prisma.user.findUnique({ where: { id: userId } });

        if (existingUser?.walletAddress) {
            return res.json({
                success: true,
                wallet: {
                    address: existingUser.walletAddress,
                    friendlyAddress: existingUser.walletFriendly || toFriendlyAddress(existingUser.walletAddress),
                },
                existing: true,
            });
        }

        const telegramId = parseTelegramId(userId);
        const now = new Date();

        if (!existingUser) {
            await prisma.user.create({
                data: {
                    id: userId,
                    telegramId,
                    createdAt: now,
                    lastLoginAt: now,
                },
            });
        }

        const wallet = generateWalletAddress();
        const friendlyAddress = toFriendlyAddress(wallet.address);

        await prisma.wallet.create({
            data: {
                address: wallet.address,
                friendlyAddress,
                userId,
                addressHash: wallet.addressHash,
                balance: 0,
            },
        });

        await prisma.user.update({
            where: { id: userId },
            data: {
                walletAddress: wallet.address,
                walletFriendly: friendlyAddress,
            },
        });

        return res.json({
            success: true,
            wallet: {
                address: wallet.address,
                friendlyAddress,
            },
            existing: false,
        });
    } catch (error) {
        console.error('Wallet creation error:', error);
        return res.status(500).json({ error: 'Failed to create wallet', code: 'WALLET_ERROR' });
    }
});

// GET /wallet/info
router.get('/info', standardLimit, requireAuth, async (req, res) => {
    try {
        const userId = req.authUser!.uid;

        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (!user) {
            return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
        }

        if (!user.walletAddress) {
            return res.status(404).json({ error: 'User has no wallet', code: 'NO_WALLET' });
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
            return res.status(404).json({ error: 'Wallet not found', code: 'WALLET_NOT_FOUND' });
        }

        const nftCount = await prisma.nft.count({ where: { ownerWallet: wallet.address } });

        return res.json({
            success: true,
            wallet: walletPayload(wallet, nftCount),
        });
    } catch (error) {
        console.error('Error fetching wallet:', error);
        return res.status(500).json({ error: 'Failed to fetch wallet', code: 'FETCH_ERROR' });
    }
});

// GET /wallet/operations
router.get('/operations', standardLimit, requireAuth, async (req, res) => {
    try {
        const userId = req.authUser!.uid;
        const limit = parseHistoryLimit(req.query.limit);
        const cursor = typeof req.query.cursor === 'string' && req.query.cursor.trim()
            ? req.query.cursor.trim()
            : null;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { walletAddress: true },
        });

        if (!user?.walletAddress) {
            return res.json({
                success: true,
                items: [],
                nextCursor: null,
                hasMore: false,
            });
        }

        if (cursor) {
            const cursorRow = await prisma.walletTransaction.findFirst({
                where: {
                    id: cursor,
                    userId,
                    walletAddress: user.walletAddress,
                },
                select: { id: true },
            });

            if (!cursorRow) {
                return res.status(400).json({ error: 'Invalid cursor', code: 'INVALID_CURSOR' });
            }
        }

        const rows = await prisma.walletTransaction.findMany({
            where: {
                userId,
                walletAddress: user.walletAddress,
            },
            orderBy: [
                { createdAt: 'desc' },
                { id: 'desc' },
            ],
            take: limit + 1,
            ...(cursor
                ? {
                    cursor: { id: cursor },
                    skip: 1,
                }
                : {}),
            select: {
                id: true,
                type: true,
                amount: true,
                currency: true,
                status: true,
                createdAt: true,
            },
        });

        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

        return res.json({
            success: true,
            items: items.map(walletOperationPayload),
            nextCursor,
            hasMore,
        });
    } catch (error) {
        console.error('Wallet operations fetch error:', error);
        return res.status(500).json({ error: 'Failed to fetch wallet operations', code: 'FETCH_ERROR' });
    }
});

// POST /wallet/topup
router.post('/topup', authLimit, requireAuth, async (req, res) => {
    try {
        const userId = req.authUser!.uid;
        const amount = parseAmount((req.body as { amount?: unknown } | undefined)?.amount);

        if (!amount) {
            return res.status(400).json({ error: 'Invalid amount', code: 'INVALID_AMOUNT' });
        }

        if (amount > MAX_WALLET_OPERATION_AMOUNT) {
            return res.status(400).json({
                error: `Amount must be <= ${MAX_WALLET_OPERATION_AMOUNT}`,
                code: 'AMOUNT_TOO_LARGE',
            });
        }

        const result = await applyWalletBalanceOperation(userId, amount, 'topup');

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
            wallet: walletPayload(result.wallet, result.nftCount),
            operation: walletOperationPayload(result.operation),
        });
    } catch (error) {
        console.error('Wallet topup error:', error);
        return res.status(500).json({ error: 'Failed to topup wallet', code: 'TOPUP_ERROR' });
    }
});

// POST /wallet/withdraw
router.post('/withdraw', authLimit, requireAuth, async (req, res) => {
    try {
        const userId = req.authUser!.uid;
        const amount = parseAmount((req.body as { amount?: unknown } | undefined)?.amount);

        if (!amount) {
            return res.status(400).json({ error: 'Invalid amount', code: 'INVALID_AMOUNT' });
        }

        if (amount > MAX_WALLET_OPERATION_AMOUNT) {
            return res.status(400).json({
                error: `Amount must be <= ${MAX_WALLET_OPERATION_AMOUNT}`,
                code: 'AMOUNT_TOO_LARGE',
            });
        }

        const result = await applyWalletBalanceOperation(userId, amount, 'withdraw');

        if ('error' in result) {
            if (result.error === 'NOT_FOUND') {
                return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
            }

            if (result.error === 'NO_WALLET') {
                return res.status(404).json({ error: 'User has no wallet', code: 'NO_WALLET' });
            }

            if (result.error === 'INSUFFICIENT_BALANCE') {
                return res.status(400).json({
                    error: 'Insufficient balance',
                    code: 'INSUFFICIENT_BALANCE',
                    currentBalance: result.currentBalance,
                });
            }

            return res.status(404).json({ error: 'Wallet not found', code: 'WALLET_NOT_FOUND' });
        }

        return res.json({
            success: true,
            wallet: walletPayload(result.wallet, result.nftCount),
            operation: walletOperationPayload(result.operation),
        });
    } catch (error) {
        console.error('Wallet withdraw error:', error);
        return res.status(500).json({ error: 'Failed to withdraw from wallet', code: 'WITHDRAW_ERROR' });
    }
});

export default router;
