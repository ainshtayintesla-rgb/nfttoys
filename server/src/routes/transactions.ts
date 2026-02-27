import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { prisma } from '../lib/db/prisma';
import { toFriendlyAddress } from '../lib/utils/crypto';
import { requireAuth } from '../middleware/auth';
import { standardLimit } from '../middleware/rateLimit';

const router = Router();

const DATE_PARAM_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_COLLECTION_NAME = 'Plush pepe';

function parseDateParam(value: string | undefined, mode: 'start' | 'end'): Date | null {
    if (!value) {
        return null;
    }

    if (!DATE_PARAM_REGEX.test(value)) {
        return null;
    }

    const [yearRaw, monthRaw, dayRaw] = value.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);

    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return null;
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) {
        return null;
    }

    if (mode === 'start') {
        return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    }

    return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
}

function safeFriendlyAddress(address: string | null): string | null {
    if (!address) {
        return null;
    }

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

router.get('/', standardLimit, requireAuth, async (req, res) => {
    try {
        const authUserId = req.authUser!.uid;
        const fromQuery = typeof req.query.from === 'string' ? req.query.from : undefined;
        const toQuery = typeof req.query.to === 'string' ? req.query.to : undefined;
        const limitQuery = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : NaN;

        const fromDate = parseDateParam(fromQuery, 'start');
        const toDate = parseDateParam(toQuery, 'end');

        if (fromQuery && !fromDate) {
            return res.status(400).json({
                error: 'Invalid from date format. Expected YYYY-MM-DD',
                code: 'VALIDATION_ERROR',
            });
        }

        if (toQuery && !toDate) {
            return res.status(400).json({
                error: 'Invalid to date format. Expected YYYY-MM-DD',
                code: 'VALIDATION_ERROR',
            });
        }

        if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
            return res.status(400).json({
                error: 'from must be less than or equal to to',
                code: 'VALIDATION_ERROR',
            });
        }

        const where: Prisma.TransactionWhereInput = {
            OR: [
                { fromUserId: authUserId },
                { toUserId: authUserId },
            ],
        };

        if (fromDate || toDate) {
            where.timestamp = {};

            if (fromDate) {
                where.timestamp.gte = fromDate;
            }

            if (toDate) {
                where.timestamp.lte = toDate;
            }
        }

        const take = Number.isFinite(limitQuery)
            ? Math.min(Math.max(limitQuery, 1), 500)
            : 200;

        const transactions = await prisma.transaction.findMany({
            where,
            orderBy: { timestamp: 'desc' },
            take,
            select: {
                id: true,
                txHash: true,
                type: true,
                from: true,
                fromUserId: true,
                to: true,
                toUserId: true,
                tokenId: true,
                modelName: true,
                serialNumber: true,
                memo: true,
                feeAmount: true,
                feeCurrency: true,
                timestamp: true,
                status: true,
                fromUserRel: {
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        photoUrl: true,
                    },
                },
                toUserRel: {
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        photoUrl: true,
                    },
                },
                nft: {
                    select: {
                        tgsFile: true,
                        metadata: true,
                    },
                },
            },
        });

        return res.json({
            success: true,
            transactions: transactions.map((row) => {
                const direction: 'in' | 'out' = row.toUserId === authUserId ? 'in' : 'out';
                const collectionName = readCollectionName(row.nft?.metadata);

                return {
                    id: row.id,
                    txHash: row.txHash,
                    type: row.type,
                    direction,
                    amount: 1,
                    asset: 'NFT',
                    from: row.from,
                    fromFriendly: safeFriendlyAddress(row.from),
                    fromUser: row.fromUserRel
                        ? {
                            id: row.fromUserRel.id,
                            username: row.fromUserRel.username,
                            firstName: row.fromUserRel.firstName,
                            photoUrl: row.fromUserRel.photoUrl,
                        }
                        : null,
                    to: row.to,
                    toFriendly: safeFriendlyAddress(row.to),
                    toUser: row.toUserRel
                        ? {
                            id: row.toUserRel.id,
                            username: row.toUserRel.username,
                            firstName: row.toUserRel.firstName,
                            photoUrl: row.toUserRel.photoUrl,
                        }
                        : null,
                    tokenId: row.tokenId,
                    modelName: row.modelName,
                    serialNumber: row.serialNumber,
                    collectionName,
                    tgsUrl: row.nft?.tgsFile ? `/models/${row.nft.tgsFile}` : null,
                    status: row.status,
                    timestamp: row.timestamp.toISOString(),
                    fee: row.feeAmount !== null && row.feeCurrency
                        ? `${row.feeAmount} ${row.feeCurrency}`
                        : null,
                    memo: row.memo,
                };
            }),
        });
    } catch (error) {
        console.error('Error fetching transactions:', error);
        return res.status(500).json({
            error: 'Failed to fetch transactions',
            code: 'FETCH_ERROR',
        });
    }
});

export default router;
