import { Router } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/db/prisma';
import { normalizedUsername } from '../lib/db/utils';
import {
    ZERO_ADDRESS,
    ZERO_FRIENDLY_ADDRESS,
    TREASURY_ADDRESS,
    TREASURY_FRIENDLY_ADDRESS,
    buildFriendlyAddressCandidates,
    toFriendlyAddress,
    signTransaction,
    generateTxHash,
    isValidAddress,
} from '../lib/utils/crypto';
import { notifyNftReceived } from '../lib/utils/telegramBot';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { standardLimit, strictLimit } from '../middleware/rateLimit';
import { csrfProtection } from '../middleware/csrfProtection';

const router = Router();

const TOKEN_SECRET = process.env.TOKEN_SECRET || '';
if (!TOKEN_SECRET) {
    throw new Error('TOKEN_SECRET environment variable is required but not set. Server cannot start without it.');
}

const ZERO_ADDRESS_HASH = ZERO_ADDRESS.slice(3);
const TREASURY_ADDRESS_HASH = TREASURY_ADDRESS.slice(3);
const DEFAULT_COLLECTION_NAME = 'Plush pepe';
const NFT_TRANSFER_FEE_AMOUNT = 741;
const NFT_TRANSFER_FEE_CURRENCY = 'UZS';
const NFT_TRANSFER_MEMO_MAX_LENGTH = 120;
const TELEGRAM_USERNAME_MAX_LENGTH = 32;

interface CollectionTotals {
    minted: number;
    active: number;
}

class TransferValidationError extends Error {
    public readonly code: string;

    public readonly statusCode: number;

    constructor(message: string, code: string, statusCode = 400) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
    }
}

function safeFriendlyAddress(address?: string | null): string | null {
    if (!address) return null;

    try {
        return toFriendlyAddress(address);
    } catch {
        return null;
    }
}

function readCollectionName(metadata: Prisma.JsonValue | null | undefined): string {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return DEFAULT_COLLECTION_NAME;
    }

    const rawCollectionName = (metadata as Record<string, unknown>).collectionName;
    if (typeof rawCollectionName !== 'string') {
        return DEFAULT_COLLECTION_NAME;
    }

    const normalized = rawCollectionName.trim();
    return normalized || DEFAULT_COLLECTION_NAME;
}

function isZeroBurnAddressInput(value: string): boolean {
    const normalized = value.trim();
    if (!normalized) {
        return false;
    }

    const zeroFriendlyCandidates = buildFriendlyAddressCandidates(ZERO_FRIENDLY_ADDRESS)
        .map((candidate) => candidate.toUpperCase());

    return (
        normalized.toLowerCase() === ZERO_ADDRESS
        || zeroFriendlyCandidates.includes(normalized.toUpperCase())
    );
}

async function ensureZeroBurnWallet(): Promise<void> {
    await prisma.wallet.upsert({
        where: { address: ZERO_ADDRESS },
        update: {
            friendlyAddress: ZERO_FRIENDLY_ADDRESS,
            userId: null,
        },
        create: {
            address: ZERO_ADDRESS,
            friendlyAddress: ZERO_FRIENDLY_ADDRESS,
            userId: null,
            addressHash: ZERO_ADDRESS_HASH,
        },
    });
}

function normalizeTransferMemo(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    if (value.length > NFT_TRANSFER_MEMO_MAX_LENGTH) {
        throw new TransferValidationError(
            `Comment max length is ${NFT_TRANSFER_MEMO_MAX_LENGTH} characters`,
            'MEMO_TOO_LONG',
            400,
        );
    }

    const trimmed = value.trim();
    return trimmed || null;
}

function normalizeUsernameLookupInput(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }

    const candidate = value.trim().replace(/^@+/, '');
    const normalized = candidate.replace(/[^a-zA-Z0-9_]/g, '');
    return normalized.slice(0, TELEGRAM_USERNAME_MAX_LENGTH);
}

// GET /nft/my - Get user's NFTs
router.get('/my', standardLimit, optionalAuth, async (req, res) => {
    try {
        const requestedUserId = req.query.userId as string | undefined;
        const walletAddress = req.query.wallet as string;
        const authUserId = req.authUser?.uid;
        const userId = requestedUserId || authUserId;

        if (!userId && !walletAddress) {
            return res.status(400).json({
                error: 'userId or wallet is required',
                code: 'VALIDATION_ERROR',
            });
        }

        if (requestedUserId && authUserId && requestedUserId !== authUserId) {
            return res.status(403).json({
                error: 'Cannot access another user NFTs',
                code: 'UNAUTHORIZED',
            });
        }

        const where: Prisma.NftWhereInput = walletAddress
            ? { ownerWallet: walletAddress }
            : { ownerId: userId };

        const [rows, collectionStatsRows] = await Promise.all([
            prisma.nft.findMany({ where }),
            prisma.$queryRaw<{ collection_name: string; minted_count: bigint; active_count: bigint }[]>(
                Prisma.sql`
                    SELECT
                        COALESCE(metadata->>'collectionName', ${DEFAULT_COLLECTION_NAME}) AS collection_name,
                        COUNT(*) AS minted_count,
                        COUNT(*) FILTER (WHERE LOWER(status) != 'burned') AS active_count
                    FROM "Nft"
                    GROUP BY COALESCE(metadata->>'collectionName', ${DEFAULT_COLLECTION_NAME})
                `,
            ),
        ]);

        const collectionTotals = new Map<string, CollectionTotals>(
            collectionStatsRows.map((row) => [
                row.collection_name,
                { minted: Number(row.minted_count), active: Number(row.active_count) },
            ]),
        );

        const nfts = rows.map((row) => ({
            ...(function getCollectionMeta() {
                const collectionName = readCollectionName(row.metadata);
                const collectionStats = collectionTotals.get(collectionName) || {
                    minted: 1,
                    active: row.status.toLowerCase() === 'burned' ? 0 : 1,
                };

                return {
                    collectionName,
                    collectionMintedCount: collectionStats.minted,
                    collectionActiveCount: collectionStats.active,
                };
            }()),
            tokenId: row.tokenId,
            contractAddress: row.contractAddress,
            modelName: row.modelName,
            serialNumber: row.serialNumber,
            rarity: row.rarity,
            tgsFile: row.tgsFile,
            tgsUrl: `/models/${row.tgsFile}`,
            mintedAt: row.mintedAt ? row.mintedAt.toISOString() : null,
            metadata: row.metadata,
        }));

        const rarityOrder = { legendary: 0, rare: 1, common: 2 };
        nfts.sort((a, b) => {
            const orderA = rarityOrder[a.rarity as keyof typeof rarityOrder] ?? 3;
            const orderB = rarityOrder[b.rarity as keyof typeof rarityOrder] ?? 3;
            return orderA - orderB;
        });

        return res.json({ success: true, count: nfts.length, nfts });
    } catch (error) {
        console.error('Error fetching NFTs:', error);
        return res.status(500).json({ error: 'Failed to fetch NFTs', code: 'FETCH_ERROR' });
    }
});

// GET /nft/recipient/search - Lookup recipient by username
router.get('/recipient/search', standardLimit, requireAuth, async (req, res) => {
    try {
        const cleanUsername = normalizeUsernameLookupInput(req.query.username);
        const lowerUsername = normalizedUsername(cleanUsername);

        if (!lowerUsername || lowerUsername.length < 2) {
            return res.status(400).json({
                error: 'username must contain at least 2 characters',
                code: 'VALIDATION_ERROR',
            });
        }

        const recipientSelect = {
            id: true,
            username: true,
            firstName: true,
            photoUrl: true,
            walletAddress: true,
            walletFriendly: true,
        };

        const exactByLower = await prisma.user.findFirst({
            where: {
                usernameLower: lowerUsername,
            },
            select: recipientSelect,
        });

        const recipient = exactByLower || await prisma.user.findFirst({
            where: {
                username: { equals: cleanUsername, mode: 'insensitive' },
            },
            select: recipientSelect,
        });

        if (!recipient) {
            return res.json({ success: true, recipient: null });
        }

        const normalizedFriendly = recipient.walletAddress
            ? safeFriendlyAddress(recipient.walletAddress)
            : null;
        const walletFriendly = normalizedFriendly || recipient.walletFriendly || null;

        return res.json({
            success: true,
            recipient: {
                id: recipient.id,
                username: recipient.username,
                firstName: recipient.firstName,
                photoUrl: recipient.photoUrl,
                walletFriendly,
            },
        });
    } catch (error) {
        console.error('Error searching recipient:', error);
        return res.status(500).json({ error: 'Recipient search failed', code: 'SEARCH_ERROR' });
    }
});

// GET /nft/:tokenId - Get NFT details
router.get('/:tokenId', standardLimit, async (req, res) => {
    try {
        const { tokenId } = req.params;

        if (!tokenId) {
            return res.status(400).json({ error: 'tokenId is required', code: 'VALIDATION_ERROR' });
        }

        const nft = await prisma.nft.findUnique({
            where: { tokenId },
            include: {
                ownerUserRel: true,
                history: {
                    orderBy: {
                        timestamp: 'asc',
                    },
                },
            },
        });

        if (!nft) {
            return res.status(404).json({ error: 'NFT not found', code: 'NOT_FOUND' });
        }

        const ownerHistory = nft.history.map((entry) => ({
            wallet: entry.wallet,
            type: entry.type,
            fromWallet: entry.fromWallet,
            friendlyAddress: safeFriendlyAddress(entry.wallet),
            date: entry.timestamp ? entry.timestamp.toISOString() : null,
        }));

        return res.json({
            success: true,
            nft: {
                tokenId: nft.tokenId,
                contractAddress: nft.contractAddress,
                modelName: nft.modelName,
                serialNumber: nft.serialNumber,
                rarity: nft.rarity,
                tgsFile: nft.tgsFile,
                tgsUrl: `/models/${nft.tgsFile}`,
                status: nft.status,
                mintedAt: nft.mintedAt ? nft.mintedAt.toISOString() : null,
                metadata: nft.metadata,
                owner: {
                    wallet: nft.ownerWallet,
                    friendlyAddress: safeFriendlyAddress(nft.ownerWallet),
                    username: nft.ownerUserRel?.username || null,
                    firstName: nft.ownerUserRel?.firstName || null,
                    photoUrl: nft.ownerUserRel?.photoUrl || null,
                },
                ownerHistory,
            },
        });
    } catch (error) {
        console.error('Error fetching NFT:', error);
        return res.status(500).json({ error: 'Failed to fetch NFT', code: 'FETCH_ERROR' });
    }
});

// POST /nft/transfer - Transfer NFT
router.post('/transfer', strictLimit, requireAuth, csrfProtection, async (req, res) => {
    try {
        const { tokenId, fromUserId: requestedFromUserId, toAddress, toUsername } = req.body;
        const fromUserId = req.authUser!.uid;
        const transferMemo = normalizeTransferMemo(req.body?.memo);

        if (!tokenId) {
            return res.status(400).json({ error: 'tokenId is required', code: 'VALIDATION_ERROR' });
        }

        if (requestedFromUserId && requestedFromUserId !== fromUserId) {
            return res.status(403).json({ error: 'fromUserId does not match token user', code: 'UNAUTHORIZED' });
        }

        if (!toAddress && !toUsername) {
            return res.status(400).json({
                error: 'Either toAddress or toUsername is required',
                code: 'VALIDATION_ERROR',
            });
        }

        const nft = await prisma.nft.findUnique({ where: { tokenId } });

        if (!nft) {
            return res.status(404).json({ error: 'NFT not found', code: 'NOT_FOUND' });
        }

        if (nft.ownerId !== fromUserId) {
            return res.status(403).json({ error: 'You do not own this NFT', code: 'UNAUTHORIZED' });
        }

        let recipientWallet: string | null = null;
        let recipientUserId: string | null = null;

        if (toUsername) {
            const cleanUsername = normalizeUsernameLookupInput(toUsername);
            const lowerUsername = normalizedUsername(cleanUsername);

            if (!lowerUsername) {
                return res.status(400).json({
                    error: 'Invalid recipient username',
                    code: 'VALIDATION_ERROR',
                });
            }

            const recipient = await prisma.user.findFirst({
                where: {
                    OR: [
                        { usernameLower: lowerUsername },
                        { username: { equals: cleanUsername, mode: 'insensitive' } },
                    ],
                },
            });

            if (!recipient || !recipient.walletAddress) {
                return res.status(404).json({ error: 'User not found', code: 'RECIPIENT_NOT_FOUND' });
            }

            recipientUserId = recipient.id;
            recipientWallet = recipient.walletAddress;
        } else if (toAddress) {
            const normalizedAddress = toAddress.trim();

            if (isZeroBurnAddressInput(normalizedAddress)) {
                await ensureZeroBurnWallet();
                recipientWallet = ZERO_ADDRESS;
                recipientUserId = null;
            } else {
                let walletAddress = normalizedAddress;
                let wallet = null;
                const friendlyCandidates = buildFriendlyAddressCandidates(normalizedAddress);

                if (friendlyCandidates.length > 0) {
                    wallet = await prisma.wallet.findFirst({
                        where: {
                            friendlyAddress: {
                                in: friendlyCandidates,
                            },
                        },
                    });

                    if (!wallet) {
                        return res.status(404).json({ error: 'Wallet not found', code: 'RECIPIENT_NOT_FOUND' });
                    }

                    walletAddress = wallet.address;
                }

                if (!isValidAddress(walletAddress)) {
                    return res.status(400).json({ error: 'Invalid wallet address format', code: 'INVALID_ADDRESS' });
                }

                wallet = wallet || await prisma.wallet.findUnique({ where: { address: walletAddress } });

                if (!wallet) {
                    return res.status(404).json({ error: 'Wallet not found', code: 'RECIPIENT_NOT_FOUND' });
                }

                recipientWallet = wallet.address;
                recipientUserId = wallet.userId;
            }
        }

        if (!recipientWallet) {
            return res.status(404).json({ error: 'Could not find recipient wallet', code: 'RECIPIENT_NOT_FOUND' });
        }


        const transferTimestamp = Date.now();
        const transactionType: 'transfer' | 'burn' = recipientWallet === ZERO_ADDRESS ? 'burn' : 'transfer';
        const transferFeeAmount = transactionType === 'transfer' ? NFT_TRANSFER_FEE_AMOUNT : null;
        const transferFeeCurrency = transactionType === 'transfer' ? NFT_TRANSFER_FEE_CURRENCY : null;

        const txData = {
            type: transactionType,
            from: nft.ownerWallet,
            to: recipientWallet,
            tokenId,
            timestamp: transferTimestamp,
        };

        const txSignature = signTransaction(txData, TOKEN_SECRET);
        const txHash = generateTxHash(transactionType, nft.ownerWallet, recipientWallet, tokenId, transferTimestamp);

        await prisma.$transaction(async (tx) => {
            if (transactionType === 'transfer') {
                if (!nft.ownerWallet) {
                    throw new TransferValidationError('Sender wallet not found', 'WALLET_NOT_FOUND', 409);
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
                    },
                });

                const debitResult = await tx.wallet.updateMany({
                    where: {
                        address: nft.ownerWallet,
                        balance: { gte: NFT_TRANSFER_FEE_AMOUNT },
                    },
                    data: {
                        balance: { decrement: NFT_TRANSFER_FEE_AMOUNT },
                    },
                });

                if (debitResult.count !== 1) {
                    throw new TransferValidationError(
                        `Insufficient balance for transfer fee (${NFT_TRANSFER_FEE_AMOUNT} ${NFT_TRANSFER_FEE_CURRENCY})`,
                        'INSUFFICIENT_FEE_BALANCE',
                        400,
                    );
                }

                await tx.wallet.update({
                    where: { address: TREASURY_ADDRESS },
                    data: {
                        balance: { increment: NFT_TRANSFER_FEE_AMOUNT },
                    },
                });
            }

            await tx.nft.update({
                where: { tokenId },
                data: {
                    ownerWallet: recipientWallet,
                    ownerId: recipientUserId,
                    status: transactionType === 'burn' ? 'burned' : nft.status,
                    lastTransferAt: new Date(),
                },
            });

            await tx.nftHistory.create({
                data: {
                    tokenId,
                    wallet: recipientWallet,
                    userId: recipientUserId,
                    type: transactionType,
                    fromWallet: nft.ownerWallet,
                    timestamp: new Date(),
                },
            });

            await tx.transaction.create({
                data: {
                    txHash,
                    type: transactionType,
                    from: nft.ownerWallet,
                    fromUserId,
                    to: recipientWallet,
                    toUserId: recipientUserId,
                    tokenId,
                    modelName: nft.modelName,
                    serialNumber: nft.serialNumber,
                    memo: transferMemo,
                    feeAmount: transferFeeAmount,
                    feeCurrency: transferFeeCurrency,
                    signature: txSignature,
                    timestamp: new Date(),
                    status: 'confirmed',
                },
            });
        });

        if (recipientUserId) {
            const [recipientUser, senderUser] = await Promise.all([
                prisma.user.findUnique({
                    where: { id: recipientUserId },
                    select: { telegramId: true },
                }),
                prisma.user.findUnique({
                    where: { id: fromUserId },
                    select: { username: true, firstName: true },
                }),
            ]);

            if (recipientUser?.telegramId) {
                void notifyNftReceived({
                    recipientTelegramId: recipientUser.telegramId,
                    modelName: nft.modelName,
                    serialNumber: nft.serialNumber,
                    rarity: nft.rarity,
                    tokenId: nft.tokenId,
                    senderUsername: senderUser?.username,
                    senderFirstName: senderUser?.firstName,
                }).catch((error) => {
                    console.error('Failed to send transfer notification:', error);
                });
            }
        }

        return res.json({
            success: true,
            transfer: {
                txHash,
                tokenId,
                from: nft.ownerWallet,
                to: recipientWallet,
                fee: transferFeeAmount !== null && transferFeeCurrency ? `${transferFeeAmount} ${transferFeeCurrency}` : null,
                memo: transferMemo,
                timestamp: new Date(transferTimestamp).toISOString(),
            },
        });
    } catch (error) {
        if (error instanceof TransferValidationError) {
            return res.status(error.statusCode).json({
                error: error.message,
                code: error.code,
            });
        }

        console.error('Transfer error:', error);
        return res.status(500).json({ error: 'Transfer failed', code: 'TRANSFER_ERROR' });
    }
});

export default router;
