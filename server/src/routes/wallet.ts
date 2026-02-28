import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { prisma } from '../lib/db/prisma';
import { normalizedUsername, parseTelegramId } from '../lib/db/utils';
import {
    TREASURY_ADDRESS,
    TREASURY_FRIENDLY_ADDRESS,
    generateWalletAddress,
    isValidAddress,
    toFriendlyAddress,
} from '../lib/utils/crypto';
import { getAdminTelegramIds } from '../middleware/admin';
import { requireAuth } from '../middleware/auth';
import { authLimit, standardLimit } from '../middleware/rateLimit';

const router = Router();
const MAX_WALLET_OPERATION_AMOUNT = 10_000_000_000;
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 50;
const TELEGRAM_USERNAME_MAX_LENGTH = 32;
const WALLET_FRIENDLY_BODY_LENGTH = 12;
const WALLET_SEND_FEE_AMOUNT = 71;
const WALLET_SEND_FEE_CURRENCY = 'UZS';
const TREASURY_ADDRESS_HASH = TREASURY_ADDRESS.slice(3);

type WalletBalanceMutationKind = 'topup' | 'withdraw';
type WalletOperationKind = 'topup' | 'withdraw' | 'send' | 'receive';

class WalletValidationError extends Error {
    public readonly code: string;

    public readonly statusCode: number;

    public readonly details?: Record<string, unknown>;

    constructor(
        message: string,
        code: string,
        statusCode = 400,
        details?: Record<string, unknown>,
    ) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}

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

function normalizeUsernameLookupInput(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }

    const candidate = value.trim().replace(/^@+/, '');
    const normalized = candidate.replace(/[^a-zA-Z0-9_]/g, '');
    return normalized.slice(0, TELEGRAM_USERNAME_MAX_LENGTH);
}

function normalizeWalletLookupInput(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }

    const candidate = value.trim();
    if (!candidate) {
        return '';
    }

    if (/^(LV-|UZ-)/i.test(candidate)) {
        const friendlyBody = candidate
            .replace(/^(LV-|UZ-)/i, '')
            .replace(/[^a-zA-Z0-9_]/g, '')
            .toUpperCase()
            .slice(0, WALLET_FRIENDLY_BODY_LENGTH);
        return friendlyBody ? `LV-${friendlyBody}` : '';
    }

    if (isValidAddress(candidate)) {
        return candidate;
    }

    const friendlyBody = candidate
        .replace(/[^a-zA-Z0-9_]/g, '')
        .toUpperCase()
        .slice(0, WALLET_FRIENDLY_BODY_LENGTH);

    return friendlyBody ? `LV-${friendlyBody}` : '';
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

async function resolveFeeWalletAddress(
    tx: Prisma.TransactionClient,
    senderWalletAddress: string,
): Promise<string> {
    const adminTelegramIds = getAdminTelegramIds();

    if (adminTelegramIds.length > 0) {
        const adminUser = await tx.user.findFirst({
            where: {
                telegramId: { in: adminTelegramIds },
                walletAddress: { not: null },
            },
            orderBy: { createdAt: 'asc' },
            select: { walletAddress: true },
        });

        if (adminUser?.walletAddress && adminUser.walletAddress !== senderWalletAddress) {
            const wallet = await tx.wallet.findUnique({
                where: { address: adminUser.walletAddress },
                select: { address: true },
            });

            if (wallet?.address) {
                return wallet.address;
            }
        }
    }

    await tx.wallet.upsert({
        where: { address: TREASURY_ADDRESS },
        update: {
            friendlyAddress: TREASURY_FRIENDLY_ADDRESS,
            userId: null,
        },
        create: {
            address: TREASURY_ADDRESS,
            friendlyAddress: TREASURY_FRIENDLY_ADDRESS,
            userId: null,
            addressHash: TREASURY_ADDRESS_HASH,
            balance: 0,
        },
    });

    return TREASURY_ADDRESS;
}

async function applyWalletBalanceOperation(userId: string, amount: number, operation: WalletBalanceMutationKind) {
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

// GET /wallet/recipient/search
router.get('/recipient/search', standardLimit, requireAuth, async (req, res) => {
    try {
        const usernameInput = normalizeUsernameLookupInput(req.query.username);
        const walletInput = normalizeWalletLookupInput(req.query.wallet);
        const hasUsername = Boolean(usernameInput);
        const hasWallet = Boolean(walletInput);

        if (hasUsername === hasWallet) {
            return res.status(400).json({
                error: 'Provide exactly one lookup target: username or wallet',
                code: 'LOOKUP_TARGET_REQUIRED',
            });
        }

        if (hasUsername) {
            if (usernameInput.length < 2) {
                return res.json({ success: true, recipient: null });
            }

            const usernameLower = normalizedUsername(usernameInput);
            if (!usernameLower) {
                return res.json({ success: true, recipient: null });
            }

            const recipient = await prisma.user.findFirst({
                where: {
                    walletAddress: { not: null },
                    OR: [
                        { usernameLower },
                        { username: { equals: usernameInput, mode: 'insensitive' } },
                    ],
                },
                select: {
                    id: true,
                    username: true,
                    firstName: true,
                    photoUrl: true,
                    walletFriendly: true,
                },
            });

            return res.json({
                success: true,
                recipient: recipient
                    ? {
                        id: recipient.id,
                        username: recipient.username,
                        firstName: recipient.firstName,
                        photoUrl: recipient.photoUrl,
                        walletFriendly: recipient.walletFriendly,
                    }
                    : null,
            });
        }

        if (!walletInput) {
            return res.json({ success: true, recipient: null });
        }

        const wallet = /^(LV-|UZ-)/i.test(walletInput)
            ? await prisma.wallet.findUnique({
                where: { friendlyAddress: walletInput.toUpperCase() },
                select: {
                    userId: true,
                    friendlyAddress: true,
                },
            })
            : await prisma.wallet.findUnique({
                where: { address: walletInput },
                select: {
                    userId: true,
                    friendlyAddress: true,
                },
            });

        if (!wallet?.userId) {
            return res.json({ success: true, recipient: null });
        }

        const recipient = await prisma.user.findUnique({
            where: { id: wallet.userId },
            select: {
                id: true,
                username: true,
                firstName: true,
                photoUrl: true,
                walletFriendly: true,
            },
        });

        return res.json({
            success: true,
            recipient: recipient
                ? {
                    id: recipient.id,
                    username: recipient.username,
                    firstName: recipient.firstName,
                    photoUrl: recipient.photoUrl,
                    walletFriendly: recipient.walletFriendly || wallet.friendlyAddress || null,
                }
                : null,
        });
    } catch (error) {
        console.error('Wallet recipient lookup error:', error);
        return res.status(500).json({ error: 'Failed to find recipient', code: 'LOOKUP_ERROR' });
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

// POST /wallet/send
router.post('/send', authLimit, requireAuth, async (req, res) => {
    try {
        const userId = req.authUser!.uid;
        const body = (req.body as {
            amount?: unknown;
            toUsername?: unknown;
            toAddress?: unknown;
        } | undefined) || {};

        const amount = parseAmount(body.amount);

        if (!amount) {
            return res.status(400).json({ error: 'Invalid amount', code: 'INVALID_AMOUNT' });
        }

        if (amount > MAX_WALLET_OPERATION_AMOUNT) {
            return res.status(400).json({
                error: `Amount must be <= ${MAX_WALLET_OPERATION_AMOUNT}`,
                code: 'AMOUNT_TOO_LARGE',
            });
        }

        const cleanUsername = normalizeUsernameLookupInput(body.toUsername);
        const rawAddressInput = typeof body.toAddress === 'string' ? body.toAddress.trim() : '';

        if ((cleanUsername ? 1 : 0) + (rawAddressInput ? 1 : 0) !== 1) {
            return res.status(400).json({
                error: 'Provide exactly one recipient: username or wallet address',
                code: 'RECIPIENT_REQUIRED',
            });
        }

        const totalDebit = amount + WALLET_SEND_FEE_AMOUNT;

        const result = await prisma.$transaction(async (tx) => {
            const senderUser = await tx.user.findUnique({
                where: { id: userId },
                select: { walletAddress: true },
            });

            if (!senderUser) {
                throw new WalletValidationError('User not found', 'NOT_FOUND', 404);
            }

            if (!senderUser.walletAddress) {
                throw new WalletValidationError('User has no wallet', 'NO_WALLET', 404);
            }

            const senderWallet = await tx.wallet.findUnique({
                where: { address: senderUser.walletAddress },
                select: {
                    address: true,
                    friendlyAddress: true,
                    balance: true,
                    createdAt: true,
                },
            });

            if (!senderWallet) {
                throw new WalletValidationError('Wallet not found', 'WALLET_NOT_FOUND', 404);
            }

            let recipientWalletAddress: string;
            let recipientUserId: string | null = null;

            if (cleanUsername) {
                const usernameLower = normalizedUsername(cleanUsername);

                if (!usernameLower || usernameLower.length < 2) {
                    throw new WalletValidationError('Invalid recipient username', 'VALIDATION_ERROR', 400);
                }

                const recipient = await tx.user.findFirst({
                    where: {
                        OR: [
                            { usernameLower },
                            { username: { equals: cleanUsername, mode: 'insensitive' } },
                        ],
                    },
                    select: {
                        id: true,
                        walletAddress: true,
                    },
                });

                if (!recipient?.walletAddress) {
                    throw new WalletValidationError('Recipient not found', 'RECIPIENT_NOT_FOUND', 404);
                }

                recipientWalletAddress = recipient.walletAddress;
                recipientUserId = recipient.id;
            } else {
                let normalizedAddress = rawAddressInput;

                if (/^(UZ-|LV-)/i.test(normalizedAddress)) {
                    const friendlyWallet = await tx.wallet.findUnique({
                        where: { friendlyAddress: normalizedAddress.toUpperCase() },
                        select: {
                            address: true,
                            userId: true,
                        },
                    });

                    if (!friendlyWallet) {
                        throw new WalletValidationError('Wallet not found', 'RECIPIENT_NOT_FOUND', 404);
                    }

                    normalizedAddress = friendlyWallet.address;
                    recipientUserId = friendlyWallet.userId;
                }

                if (!isValidAddress(normalizedAddress)) {
                    throw new WalletValidationError('Invalid wallet address format', 'INVALID_ADDRESS', 400);
                }

                const recipientWallet = await tx.wallet.findUnique({
                    where: { address: normalizedAddress },
                    select: {
                        address: true,
                        userId: true,
                    },
                });

                if (!recipientWallet) {
                    throw new WalletValidationError('Wallet not found', 'RECIPIENT_NOT_FOUND', 404);
                }

                recipientWalletAddress = recipientWallet.address;
                recipientUserId = recipientWallet.userId;
            }

            if (recipientWalletAddress === senderWallet.address) {
                throw new WalletValidationError('Cannot transfer to yourself', 'SELF_TRANSFER', 400);
            }

            const debitResult = await tx.wallet.updateMany({
                where: {
                    address: senderWallet.address,
                    balance: { gte: totalDebit },
                },
                data: {
                    balance: { decrement: totalDebit },
                },
            });

            if (debitResult.count !== 1) {
                throw new WalletValidationError('Insufficient balance', 'INSUFFICIENT_BALANCE', 400, {
                    currentBalance: senderWallet.balance,
                    requiredBalance: totalDebit,
                });
            }

            const feeWalletAddress = await resolveFeeWalletAddress(tx, senderWallet.address);

            await tx.wallet.update({
                where: { address: recipientWalletAddress },
                data: {
                    balance: { increment: amount },
                },
            });

            await tx.wallet.update({
                where: { address: feeWalletAddress },
                data: {
                    balance: { increment: WALLET_SEND_FEE_AMOUNT },
                },
            });

            const senderOperation = await tx.walletTransaction.create({
                data: {
                    walletAddress: senderWallet.address,
                    userId,
                    type: 'send',
                    amount,
                    currency: WALLET_SEND_FEE_CURRENCY,
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

            if (recipientUserId) {
                await tx.walletTransaction.create({
                    data: {
                        walletAddress: recipientWalletAddress,
                        userId: recipientUserId,
                        type: 'receive',
                        amount,
                        currency: WALLET_SEND_FEE_CURRENCY,
                        status: 'completed',
                    },
                });
            }

            const updatedWallet = await tx.wallet.findUnique({
                where: { address: senderWallet.address },
                select: {
                    address: true,
                    friendlyAddress: true,
                    balance: true,
                    createdAt: true,
                },
            });

            if (!updatedWallet) {
                throw new WalletValidationError('Wallet not found', 'WALLET_NOT_FOUND', 404);
            }

            const nftCount = await tx.nft.count({ where: { ownerWallet: updatedWallet.address } });

            return {
                wallet: updatedWallet,
                nftCount,
                operation: senderOperation,
                totalDebit,
            };
        });

        return res.json({
            success: true,
            wallet: walletPayload(result.wallet, result.nftCount),
            operation: walletOperationPayload(result.operation),
            fee: {
                amount: WALLET_SEND_FEE_AMOUNT,
                currency: WALLET_SEND_FEE_CURRENCY,
                totalDebited: result.totalDebit,
            },
        });
    } catch (error) {
        if (error instanceof WalletValidationError) {
            return res.status(error.statusCode).json({
                error: error.message,
                code: error.code,
                ...(error.details ? error.details : {}),
            });
        }

        console.error('Wallet send error:', error);
        return res.status(500).json({ error: 'Failed to send funds', code: 'SEND_ERROR' });
    }
});

export default router;
