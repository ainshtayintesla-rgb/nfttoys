import crypto from 'crypto';

import { Prisma } from '@prisma/client';

import { walletV2AccessTokenTtlSec, signWalletV2AccessToken } from '../../../lib/auth/walletV2Jwt';
import {
    generateAddressV2,
    generateOpaqueRefreshToken,
    hashRefreshToken,
} from '../../../lib/walletV2/security';
import { prisma } from '../../../lib/db/prisma';
import { REFRESH_TOKEN_TTL_SEC } from '../constants';
import { DeviceInput, DevicePlatform, WalletV2PinLookupClient, WalletV2PinRecord } from '../types';
import { ApiError } from '../types';
import { now } from './utils';

export async function ensureUserExists(userId: string, telegramId: number): Promise<void> {
    const currentTime = now();

    await prisma.user.upsert({
        where: { id: userId },
        create: {
            id: userId,
            telegramId: String(telegramId),
            createdAt: currentTime,
            lastLoginAt: currentTime,
        },
        update: {
            telegramId: String(telegramId),
            lastLoginAt: currentTime,
        },
    });
}

export async function createAuditEvent(params: {
    tx?: Prisma.TransactionClient;
    walletId?: string | null;
    userId?: string | null;
    event: string;
    ipHash?: string | null;
    userAgent?: string | null;
    meta?: Prisma.InputJsonValue;
}): Promise<void> {
    const client = params.tx ?? prisma;

    await client.auditEventV2.create({
        data: {
            id: crypto.randomUUID(),
            walletId: params.walletId || null,
            userId: params.userId || null,
            event: params.event,
            ipHash: params.ipHash || null,
            userAgent: params.userAgent || null,
            meta: params.meta,
        },
    });
}

export async function createUniqueMainAddress(tx: Prisma.TransactionClient, walletId: string): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const address = generateAddressV2();

        try {
            await tx.addressV2.create({
                data: {
                    id: crypto.randomUUID(),
                    walletId,
                    address,
                    type: 'main',
                    status: 'active',
                },
            });

            return address;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                const existingMain = await tx.addressV2.findFirst({
                    where: {
                        walletId,
                        type: 'main',
                        status: 'active',
                    },
                    select: {
                        address: true,
                    },
                });

                if (existingMain?.address) {
                    return existingMain.address;
                }

                continue;
            }

            throw error;
        }
    }

    throw new ApiError(500, 'ADDRESS_GENERATION_FAILED', 'Failed to generate unique wallet address');
}

export async function getMainAddress(tx: Prisma.TransactionClient, walletId: string): Promise<string> {
    const existing = await tx.addressV2.findFirst({
        where: {
            walletId,
            type: 'main',
            status: 'active',
        },
        select: { address: true },
    });

    if (existing?.address) {
        return existing.address;
    }

    return createUniqueMainAddress(tx, walletId);
}

export async function issueWalletSession(tx: Prisma.TransactionClient, params: {
    walletId: string;
    userId: string | null;
    device: DeviceInput;
    ipHash: string | null;
    userAgent: string | null;
}) {
    const createdAt = now();

    await tx.walletSessionV2.updateMany({
        where: {
            walletId: params.walletId,
            deviceId: params.device.deviceId,
            status: 'active',
        },
        data: {
            status: 'revoked',
            revokedAt: createdAt,
            revokedReason: 'replaced',
            lastSeenAt: createdAt,
        },
    });

    const refreshToken = generateOpaqueRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const refreshTokenExpiresAt = new Date(createdAt.getTime() + REFRESH_TOKEN_TTL_SEC * 1000);
    const sessionId = crypto.randomUUID();

    const session = await tx.walletSessionV2.create({
        data: {
            id: sessionId,
            walletId: params.walletId,
            userId: params.userId,
            deviceId: params.device.deviceId,
            platform: params.device.platform,
            biometricSupported: params.device.biometricSupported,
            devicePubkey: params.device.devicePubKey,
            refreshTokenHash,
            refreshTokenExpiresAt,
            status: 'active',
            lastSeenAt: createdAt,
            lastIpHash: params.ipHash,
            userAgent: params.userAgent,
        },
        select: {
            id: true,
            walletId: true,
            userId: true,
            deviceId: true,
            platform: true,
        },
    });

    const accessToken = signWalletV2AccessToken({
        sid: session.id,
        wid: session.walletId,
        uid: session.userId || undefined,
        did: session.deviceId,
        platform: session.platform as DevicePlatform,
    });

    return {
        session,
        accessToken,
        refreshToken,
        expiresInSec: walletV2AccessTokenTtlSec(),
    };
}

export async function getLatestGlobalPinRecord(
    client: WalletV2PinLookupClient,
    params: {
        userId?: string | null;
        walletId?: string | null;
    },
): Promise<WalletV2PinRecord | null> {
    const normalizedUserId = params.userId?.trim();

    if (normalizedUserId) {
        const userWalletPin = await client.walletV2.findFirst({
            where: {
                userId: normalizedUserId,
                status: { not: 'deleted' },
            },
            orderBy: [
                { updatedAt: 'desc' },
                { createdAt: 'desc' },
            ],
            select: {
                id: true,
                pinHash: true,
                pinSalt: true,
            },
        });

        if (userWalletPin) {
            return {
                walletId: userWalletPin.id,
                pinHash: userWalletPin.pinHash,
                pinSalt: userWalletPin.pinSalt,
            };
        }
    }

    const normalizedWalletId = params.walletId?.trim();

    if (normalizedWalletId) {
        const walletPin = await client.walletV2.findUnique({
            where: { id: normalizedWalletId },
            select: {
                id: true,
                pinHash: true,
                pinSalt: true,
            },
        });

        if (walletPin) {
            return {
                walletId: walletPin.id,
                pinHash: walletPin.pinHash,
                pinSalt: walletPin.pinSalt,
            };
        }
    }

    return null;
}

export async function applyGlobalPinToUserWallets(
    tx: Prisma.TransactionClient,
    userId: string,
    pinHash: string,
    pinSalt: string,
    updatedAt: Date,
): Promise<number> {
    const updateResult = await tx.walletV2.updateMany({
        where: {
            userId,
            status: { not: 'deleted' },
        },
        data: {
            pinHash,
            pinSalt,
            updatedAt,
        },
    });

    return updateResult.count;
}

export async function cancelPendingTxAndReleaseLocked(
    tx: Prisma.TransactionClient,
    txId: string,
    walletId: string,
    asset: string,
    amount: bigint,
    status: 'canceled' | 'failed',
    timestamp: Date,
): Promise<void> {
    await tx.balanceV2.updateMany({
        where: {
            walletId,
            asset,
            locked: { gte: amount },
        },
        data: {
            locked: { decrement: amount },
            available: { increment: amount },
            updatedAt: timestamp,
        },
    });

    await tx.txV2.updateMany({
        where: {
            id: txId,
            status: 'pending_confirmation',
        },
        data: {
            status,
            completedAt: timestamp,
        },
    });
}
