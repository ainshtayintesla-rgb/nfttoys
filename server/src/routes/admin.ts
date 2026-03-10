import { Router, Response } from 'express';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/db/prisma';
import { normalizedUsername } from '../lib/db/utils';
import {
    TREASURY_ADDRESS,
    TREASURY_FRIENDLY_ADDRESS,
    buildFriendlyAddressCandidates,
    getFriendlyAddressPrefix,
    getWalletNetwork,
    isValidAddress,
    normalizeFriendlyAddressForNetwork,
    toFriendlyAddress,
} from '../lib/utils/crypto';
import { getUpdateService, UpdateServiceError } from '../lib/updateService';
import { requireAdmin, getAdminTelegramIds } from '../middleware/admin';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrfProtection';
import { standardLimit, strictLimit } from '../middleware/rateLimit';
import { isNftStakingSchemaNotReadyError } from './walletV2/helpers/staking';

const router = Router();

const CONFIRM_DELETE_ALL_NFTS = 'DELETE ALL NFTS';
const CONFIRM_DELETE_ALL_USERS = 'DELETE ALL USERS';
const TELEGRAM_USERNAME_MAX_LENGTH = 32;
const WALLET_FRIENDLY_BODY_LENGTH = 30;
const MAX_ADMIN_TOPUP_AMOUNT = 10_000_000_000;
const MIN_TOPUP_TRANSACTION_ID_LENGTH = 12;
const MAX_TOPUP_TRANSACTION_ID_LENGTH = 80;
const TOPUP_TRANSACTION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const WALLET_NETWORK = getWalletNetwork();
const WALLET_FRIENDLY_PREFIX = getFriendlyAddressPrefix();

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

function normalizeUsernameLookupInput(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }

    return value
        .trim()
        .replace(/^@+/, '')
        .replace(/[^a-zA-Z0-9_]/g, '')
        .slice(0, TELEGRAM_USERNAME_MAX_LENGTH);
}

function normalizeWalletLookupInput(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }

    const candidate = value.trim();
    if (!candidate) {
        return '';
    }

    const normalizedFriendly = normalizeFriendlyAddressForNetwork(candidate);
    if (normalizedFriendly) {
        return normalizedFriendly;
    }

    if (isValidAddress(candidate)) {
        return candidate;
    }

    const body = candidate
        .replace(/^(?:LV-|tLV-|UZ-)/i, '')
        .replace(/[^a-zA-Z0-9_]/g, '')
        .toUpperCase()
        .slice(0, WALLET_FRIENDLY_BODY_LENGTH);
    return body ? `${WALLET_FRIENDLY_PREFIX}${body}` : '';
}

function safeFriendlyAddress(address: string): string {
    try {
        return toFriendlyAddress(address);
    } catch {
        return '';
    }
}

function normalizeConfirmValue(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim().toUpperCase();
}

function parseTopupTransactionId(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    if (
        normalized.length < MIN_TOPUP_TRANSACTION_ID_LENGTH
        || normalized.length > MAX_TOPUP_TRANSACTION_ID_LENGTH
    ) {
        return null;
    }

    if (!TOPUP_TRANSACTION_ID_PATTERN.test(normalized)) {
        return null;
    }

    return normalized;
}

function walletInputMatchesOperation(
    walletInput: string,
    operation: {
        walletAddress: string;
        toAddress: string | null;
        toFriendly: string | null;
    },
): boolean {
    const inputFriendlyCandidates = buildFriendlyAddressCandidates(walletInput)
        .map((candidate) => candidate.toUpperCase());

    if (inputFriendlyCandidates.length > 0) {
        const operationFriendlyCandidates = [
            operation.toFriendly ? (normalizeFriendlyAddressForNetwork(operation.toFriendly) || operation.toFriendly) : null,
            safeFriendlyAddress(operation.walletAddress),
            operation.toAddress ? safeFriendlyAddress(operation.toAddress) : null,
        ]
            .filter((candidate): candidate is string => Boolean(candidate))
            .map((candidate) => candidate.toUpperCase());

        return operationFriendlyCandidates.some((candidate) => (
            inputFriendlyCandidates.includes(candidate)
        ));
    }

    return walletInput === operation.walletAddress
        || (Boolean(operation.toAddress) && walletInput === operation.toAddress);
}

const adminTopupReplaySelect = {
    id: true,
    requestId: true,
    walletAddress: true,
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
    wallet: {
        select: {
            address: true,
            friendlyAddress: true,
            userId: true,
            user: {
                select: {
                    id: true,
                    username: true,
                    firstName: true,
                    photoUrl: true,
                },
            },
        },
    },
} satisfies Prisma.WalletTransactionSelect;

type AdminTopupReplayRow = Prisma.WalletTransactionGetPayload<{
    select: typeof adminTopupReplaySelect;
}>;

async function loadTopupReplayByRequestId(transactionId: string): Promise<AdminTopupReplayRow | null> {
    return prisma.walletTransaction.findUnique({
        where: { requestId: transactionId },
        select: adminTopupReplaySelect,
    });
}

function buildTopupReplayResponse(operation: AdminTopupReplayRow) {
    const walletFriendly = safeFriendlyAddress(operation.walletAddress)
        || operation.wallet.friendlyAddress
        || operation.toFriendly
        || toFriendlyAddress(operation.walletAddress);

    return {
        target: {
            walletAddress: operation.walletAddress,
            walletFriendly,
            user: operation.wallet.user
                ? {
                    id: operation.wallet.user.id,
                    username: operation.wallet.user.username,
                    firstName: operation.wallet.user.firstName,
                    photoUrl: operation.wallet.user.photoUrl,
                }
                : null,
        },
        operation: {
            id: operation.id,
            type: operation.type,
            amount: operation.amount,
            currency: operation.currency,
            status: operation.status,
            fromAddress: operation.fromAddress,
            fromFriendly: operation.fromFriendly,
            toAddress: operation.toAddress,
            toFriendly: operation.toFriendly,
            memo: operation.memo,
            feeAmount: operation.feeAmount,
            feeCurrency: operation.feeCurrency,
            createdAt: operation.createdAt.toISOString(),
        },
    };
}

function isRequestIdUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        return false;
    }

    const target = error.meta?.target;
    if (Array.isArray(target)) {
        return target.includes('requestId');
    }

    if (typeof target === 'string') {
        return target.includes('requestId');
    }

    return false;
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

router.get('/wallet/recipient/search', standardLimit, requireAuth, requireAdmin, async (req, res) => {
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
                return res.json({ success: true, target: null });
            }

            const usernameLower = normalizedUsername(usernameInput);
            if (!usernameLower) {
                return res.json({ success: true, target: null });
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
                    walletAddress: true,
                    walletFriendly: true,
                },
            });

            if (!recipient?.walletAddress) {
                return res.json({ success: true, target: null });
            }

            const wallet = await prisma.wallet.findUnique({
                where: { address: recipient.walletAddress },
                select: {
                    address: true,
                    friendlyAddress: true,
                },
            });

            const walletFriendly = wallet?.friendlyAddress
                || recipient.walletFriendly
                || toFriendlyAddress(recipient.walletAddress);
            const normalizedFriendly = safeFriendlyAddress(recipient.walletAddress)
                || walletFriendly;

            return res.json({
                success: true,
                target: {
                    walletAddress: recipient.walletAddress,
                    walletFriendly: normalizedFriendly,
                    user: {
                        id: recipient.id,
                        username: recipient.username,
                        firstName: recipient.firstName,
                        photoUrl: recipient.photoUrl,
                    },
                },
            });
        }

        if (!walletInput) {
            return res.json({ success: true, target: null });
        }

        const friendlyCandidates = buildFriendlyAddressCandidates(walletInput);

        const wallet = friendlyCandidates.length > 0
            ? await prisma.wallet.findFirst({
                where: {
                    friendlyAddress: {
                        in: friendlyCandidates,
                    },
                },
                select: {
                    address: true,
                    friendlyAddress: true,
                    userId: true,
                },
            })
            : await prisma.wallet.findUnique({
                where: { address: walletInput },
                select: {
                    address: true,
                    friendlyAddress: true,
                    userId: true,
                },
            });

        if (!wallet) {
            if (isValidAddress(walletInput)) {
                return res.json({
                    success: true,
                    target: {
                        walletAddress: walletInput,
                        walletFriendly: safeFriendlyAddress(walletInput) || toFriendlyAddress(walletInput),
                        user: null,
                    },
                });
            }

            return res.json({ success: true, target: null });
        }

        const recipient = wallet.userId
            ? await prisma.user.findUnique({
                where: { id: wallet.userId },
                select: {
                    id: true,
                    username: true,
                    firstName: true,
                    photoUrl: true,
                },
            })
            : null;

        return res.json({
            success: true,
            target: {
                walletAddress: wallet.address,
                walletFriendly: safeFriendlyAddress(wallet.address) || wallet.friendlyAddress,
                user: recipient
                    ? {
                        id: recipient.id,
                        username: recipient.username,
                        firstName: recipient.firstName,
                        photoUrl: recipient.photoUrl,
                    }
                    : null,
            },
        });
    } catch (error) {
        console.error('Admin wallet recipient lookup error:', error);
        return res.status(500).json({
            error: 'Failed to find wallet recipient',
            code: 'LOOKUP_FAILED',
        });
    }
});

router.post('/wallet/topup', strictLimit, requireAuth, requireAdmin, csrfProtection, async (req, res) => {
    try {
        if (WALLET_NETWORK !== 'testnet') {
            return res.status(403).json({
                error: 'Top up is available only in testnet mode',
                code: 'TOPUP_DISABLED',
            });
        }

        const amount = parseAmount(req.body?.amount);
        if (!amount) {
            return res.status(400).json({
                error: 'Invalid amount',
                code: 'INVALID_AMOUNT',
            });
        }

        if (amount > MAX_ADMIN_TOPUP_AMOUNT) {
            return res.status(400).json({
                error: `Amount must be <= ${MAX_ADMIN_TOPUP_AMOUNT}`,
                code: 'AMOUNT_TOO_LARGE',
            });
        }

        const walletInput = normalizeWalletLookupInput(req.body?.wallet);
        if (!walletInput) {
            return res.status(400).json({
                error: 'Invalid wallet',
                code: 'INVALID_WALLET',
            });
        }

        const transactionId = parseTopupTransactionId(req.body?.transactionId);
        if (!transactionId) {
            return res.status(400).json({
                error: 'Invalid transaction ID',
                code: 'INVALID_TRANSACTION_ID',
            });
        }

        const actorUserId = req.authUser!.uid;

        const existingOperation = await loadTopupReplayByRequestId(transactionId);
        if (existingOperation) {
            const hasSamePayload = existingOperation.type === 'topup'
                && existingOperation.amount === amount
                && walletInputMatchesOperation(walletInput, existingOperation);

            if (!hasSamePayload) {
                return res.status(409).json({
                    error: 'Transaction ID already used with different payload',
                    code: 'TRANSACTION_ID_CONFLICT',
                });
            }

            return res.json({
                success: true,
                replayed: true,
                ...buildTopupReplayResponse(existingOperation),
            });
        }

        const runTopupTransaction = () => prisma.$transaction(async (tx) => {
            const friendlyCandidates = buildFriendlyAddressCandidates(walletInput);

            let wallet = friendlyCandidates.length > 0
                ? await tx.wallet.findFirst({
                    where: {
                        friendlyAddress: {
                            in: friendlyCandidates,
                        },
                    },
                    select: {
                        address: true,
                        friendlyAddress: true,
                        userId: true,
                        balance: true,
                        createdAt: true,
                    },
                })
                : await tx.wallet.findUnique({
                    where: { address: walletInput },
                    select: {
                        address: true,
                        friendlyAddress: true,
                        userId: true,
                        balance: true,
                        createdAt: true,
                    },
                });

            if (!wallet && isValidAddress(walletInput)) {
                wallet = await tx.wallet.create({
                    data: {
                        address: walletInput,
                        friendlyAddress: toFriendlyAddress(walletInput),
                        addressHash: walletInput.slice(3),
                        userId: null,
                        balance: 0,
                    },
                    select: {
                        address: true,
                        friendlyAddress: true,
                        userId: true,
                        balance: true,
                        createdAt: true,
                    },
                });
            }

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
                    userId: true,
                    balance: true,
                    createdAt: true,
                },
            });

            const operation = await tx.walletTransaction.create({
                data: {
                    requestId: transactionId,
                    walletAddress: updatedWallet.address,
                    userId: updatedWallet.userId,
                    type: 'topup',
                    amount,
                    currency: 'UZS',
                    status: 'completed',
                    fromAddress: TREASURY_ADDRESS,
                    fromFriendly: TREASURY_FRIENDLY_ADDRESS,
                    toAddress: updatedWallet.address,
                    toFriendly: safeFriendlyAddress(updatedWallet.address) || updatedWallet.friendlyAddress,
                    memo: `admin_topup:${actorUserId}`,
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

            const recipient = updatedWallet.userId
                ? await tx.user.findUnique({
                    where: { id: updatedWallet.userId },
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        photoUrl: true,
                    },
                })
                : null;

            return {
                wallet: updatedWallet,
                operation,
                recipient,
            } as const;
        });

        type TopupTransactionResult = Awaited<ReturnType<typeof runTopupTransaction>>;
        let result: TopupTransactionResult;
        try {
            result = await runTopupTransaction();
        } catch (error) {
            if (isRequestIdUniqueConstraintError(error)) {
                const replay = await loadTopupReplayByRequestId(transactionId);
                if (replay) {
                    return res.json({
                        success: true,
                        replayed: true,
                        ...buildTopupReplayResponse(replay),
                    });
                }
            }

            throw error;
        }

        if ('error' in result) {
            return res.status(404).json({
                error: 'Wallet not found',
                code: result.error,
            });
        }

        return res.json({
            success: true,
            target: {
                walletAddress: result.wallet.address,
                walletFriendly: safeFriendlyAddress(result.wallet.address) || result.wallet.friendlyAddress,
                user: result.recipient
                    ? {
                        id: result.recipient.id,
                        username: result.recipient.username,
                        firstName: result.recipient.firstName,
                        photoUrl: result.recipient.photoUrl,
                    }
                    : null,
            },
            operation: {
                ...result.operation,
                createdAt: result.operation.createdAt.toISOString(),
            },
        });
    } catch (error) {
        console.error('Admin wallet topup error:', error);
        return res.status(500).json({
            error: 'Failed to topup wallet',
            code: 'TOPUP_FAILED',
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

// ─── Userbot Session Management ─────────────────────────────────────────────

const USERBOT_API_URL = process.env.USERBOT_API_URL || 'http://userbot:8095';

function assertUserbotSessionPrismaReady(): boolean {
    const delegate = (prisma as unknown as { userbotSession?: unknown }).userbotSession;
    return delegate !== undefined;
}

router.get('/userbot/session', requireAuth, requireAdmin, async (_req, res) => {
    try {
        if (!assertUserbotSessionPrismaReady()) {
            return res.json({
                success: true,
                session: null,
                schemaReady: false,
            });
        }

        const session = await (prisma as unknown as {
            userbotSession: { findFirst: Function };
        }).userbotSession.findFirst({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                phone: true,
                status: true,
                errorMessage: true,
                lastActiveAt: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return res.json({
            success: true,
            session: session
                ? {
                    ...session,
                    lastActiveAt: session.lastActiveAt?.toISOString() || null,
                    createdAt: session.createdAt.toISOString(),
                    updatedAt: session.updatedAt.toISOString(),
                }
                : null,
            schemaReady: true,
        });
    } catch (error) {
        console.error('Admin userbot session fetch error:', error);
        return res.status(500).json({
            error: 'Failed to fetch userbot session',
            code: 'USERBOT_SESSION_FETCH_FAILED',
        });
    }
});

router.post('/userbot/session/init', strictLimit, requireAuth, requireAdmin, csrfProtection, async (req, res) => {
    try {
        if (!assertUserbotSessionPrismaReady()) {
            return res.status(503).json({
                error: 'Userbot schema not ready. Run migrations.',
                code: 'USERBOT_SCHEMA_NOT_READY',
            });
        }

        const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
        if (!phone || !/^\+?\d{7,15}$/.test(phone.replace(/[\s()-]/g, ''))) {
            return res.status(400).json({
                error: 'Valid phone number is required',
                code: 'INVALID_PHONE',
            });
        }

        const normalizedPhone = phone.replace(/[\s()-]/g, '');

        // Upsert session record
        const sessionId = crypto.randomUUID();
        const session = await (prisma as unknown as {
            userbotSession: { upsert: Function };
        }).userbotSession.upsert({
            where: { phone: normalizedPhone },
            update: {
                status: 'awaiting_code',
                errorMessage: null,
            },
            create: {
                id: sessionId,
                phone: normalizedPhone,
                status: 'awaiting_code',
            },
        });

        // Send request to userbot service to initiate login
        try {
            const response = await fetch(`${USERBOT_API_URL}/auth/send-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: normalizedPhone, sessionId: session.id }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
                const errMsg = typeof errorData.error === 'string' ? errorData.error : `Userbot service returned ${response.status}`;
                await (prisma as unknown as {
                    userbotSession: { update: Function };
                }).userbotSession.update({
                    where: { id: session.id },
                    data: {
                        status: 'error',
                        errorMessage: errMsg,
                    },
                });

                return res.status(502).json({
                    error: errMsg,
                    code: 'USERBOT_SEND_CODE_FAILED',
                });
            }
        } catch (fetchError) {
            await (prisma as unknown as {
                userbotSession: { update: Function };
            }).userbotSession.update({
                where: { id: session.id },
                data: {
                    status: 'error',
                    errorMessage: 'Userbot service unreachable',
                },
            });

            return res.status(502).json({
                error: 'Userbot service is not running or unreachable',
                code: 'USERBOT_UNREACHABLE',
            });
        }

        return res.json({
            success: true,
            sessionId: session.id,
            status: 'awaiting_code',
        });
    } catch (error) {
        console.error('Admin userbot session init error:', error);
        return res.status(500).json({
            error: 'Failed to initialize userbot session',
            code: 'USERBOT_INIT_FAILED',
        });
    }
});

router.post('/userbot/session/verify', strictLimit, requireAuth, requireAdmin, csrfProtection, async (req, res) => {
    try {
        if (!assertUserbotSessionPrismaReady()) {
            return res.status(503).json({
                error: 'Userbot schema not ready',
                code: 'USERBOT_SCHEMA_NOT_READY',
            });
        }

        const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
        const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : undefined;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required', code: 'MISSING_SESSION_ID' });
        }

        if (!code && !password) {
            return res.status(400).json({ error: 'code or password is required', code: 'MISSING_CREDENTIALS' });
        }

        // Forward to userbot service
        const response = await fetch(`${USERBOT_API_URL}/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, code: code || undefined, password }),
        });

        const data = await response.json().catch(() => ({ error: 'Invalid response from userbot' })) as Record<string, unknown>;
        const dataError = typeof data.error === 'string' ? data.error : 'Verification failed';
        const dataCode = typeof data.code === 'string' ? data.code : '';

        if (!response.ok) {
            // If 2FA required, update status
            if (dataCode === 'TWO_FA_REQUIRED') {
                await (prisma as unknown as {
                    userbotSession: { update: Function };
                }).userbotSession.update({
                    where: { id: sessionId },
                    data: { status: 'awaiting_2fa' },
                });

                return res.status(200).json({
                    success: false,
                    requires2fa: true,
                    sessionId,
                    status: 'awaiting_2fa',
                });
            }

            await (prisma as unknown as {
                userbotSession: { update: Function };
            }).userbotSession.update({
                where: { id: sessionId },
                data: {
                    status: 'error',
                    errorMessage: dataError,
                },
            });

            return res.status(response.status >= 500 ? 502 : response.status).json({
                error: dataError,
                code: dataCode || 'USERBOT_VERIFY_FAILED',
            });
        }

        // Success — save session string
        const sessionString = typeof data.sessionString === 'string' ? data.sessionString : null;
        await (prisma as unknown as {
            userbotSession: { update: Function };
        }).userbotSession.update({
            where: { id: sessionId },
            data: {
                status: 'active',
                sessionString,
                errorMessage: null,
                lastActiveAt: new Date(),
            },
        });

        return res.json({
            success: true,
            sessionId,
            status: 'active',
        });
    } catch (error) {
        console.error('Admin userbot session verify error:', error);
        return res.status(500).json({
            error: 'Failed to verify userbot session',
            code: 'USERBOT_VERIFY_FAILED',
        });
    }
});

router.post('/userbot/session/disconnect', strictLimit, requireAuth, requireAdmin, csrfProtection, async (req, res) => {
    try {
        if (!assertUserbotSessionPrismaReady()) {
            return res.status(503).json({
                error: 'Userbot schema not ready',
                code: 'USERBOT_SCHEMA_NOT_READY',
            });
        }

        const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required', code: 'MISSING_SESSION_ID' });
        }

        // Tell userbot to disconnect
        try {
            await fetch(`${USERBOT_API_URL}/auth/disconnect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId }),
            });
        } catch {
            // Userbot service may be down; proceed with DB cleanup
        }

        await (prisma as unknown as {
            userbotSession: { update: Function };
        }).userbotSession.update({
            where: { id: sessionId },
            data: {
                status: 'inactive',
                sessionString: null,
                errorMessage: null,
            },
        });

        return res.json({
            success: true,
            status: 'inactive',
        });
    } catch (error) {
        console.error('Admin userbot session disconnect error:', error);
        return res.status(500).json({
            error: 'Failed to disconnect userbot session',
            code: 'USERBOT_DISCONNECT_FAILED',
        });
    }
});

// ─── Story Boost Admin Stats ────────────────────────────────────────────────

router.get('/story-boost/stats', requireAuth, requireAdmin, async (_req, res) => {
    try {
        const nftStoryShareReady = (prisma as unknown as { nftStoryShare?: unknown }).nftStoryShare !== undefined;
        if (!nftStoryShareReady) {
            return res.json({ success: true, stats: null, schemaReady: false });
        }

        const [totalShares, activeBoosts, verifiedShares] = await Promise.all([
            (prisma as unknown as { nftStoryShare: { count: Function } }).nftStoryShare.count(),
            (prisma as unknown as { nftStoryShare: { count: Function } }).nftStoryShare.count({
                where: {
                    status: 'verified',
                    boostExpiresAt: { gt: new Date() },
                },
            }),
            (prisma as unknown as { nftStoryShare: { count: Function } }).nftStoryShare.count({
                where: { status: 'verified' },
            }),
        ]);

        return res.json({
            success: true,
            stats: { totalShares, activeBoosts, verifiedShares },
            schemaReady: true,
        });
    } catch (error) {
        if (isNftStakingSchemaNotReadyError(error)) {
            console.warn('Admin story boost stats schema not ready:', {
                code: error.code,
                meta: error.meta,
            });

            return res.json({
                success: true,
                stats: null,
                schemaReady: false,
            });
        }

        console.error('Admin story boost stats error:', error);
        return res.status(500).json({
            error: 'Failed to fetch story boost stats',
            code: 'STORY_BOOST_STATS_FAILED',
        });
    }
});

export default router;
