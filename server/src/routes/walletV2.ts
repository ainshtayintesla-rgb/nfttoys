import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { Request, Response, Router } from 'express';

import { walletV2AccessTokenTtlSec, signWalletV2AccessToken } from '../lib/auth/walletV2Jwt';
import { prisma } from '../lib/db/prisma';
import {
    WALLET_V2_ADDRESS_REGEX,
    buildChallengeMessage,
    generateAddressV2,
    generateChallengeNonce,
    generateMnemonic24Words,
    generateOpaqueRefreshToken,
    generateSalt,
    hashChallengeNonce,
    hashIpAddress,
    hashRefreshToken,
    hashSecret,
    isValidPin,
    mnemonicFingerprint,
    parseAmountToBigInt,
    parseAndNormalizeMnemonicInput,
    verifyEd25519Signature,
    verifySecret,
} from '../lib/walletV2/security';
import { requireAuth } from '../middleware/auth';
import { authLimit, strictLimit, standardLimit } from '../middleware/rateLimit';
import { requireWalletV2Auth } from '../middleware/walletV2Auth';
import {
    walletV2ImportLimit,
    walletV2SessionLogoutLimit,
    walletV2SessionRefreshLimit,
    walletV2SessionsRevokeLimit,
} from '../middleware/walletV2RateLimit';

const router = Router();

const DEFAULT_ASSET = 'UZS';
const VALID_ASSET_REGEX = /^[A-Z0-9_]{2,16}$/;
const VALID_IDEMPOTENCY_KEY_REGEX = /^[a-zA-Z0-9._:-]{8,128}$/;
const REFRESH_TOKEN_TTL_SEC = Number.parseInt(process.env.WALLET_V2_REFRESH_TOKEN_TTL_SEC || '', 10) || 60 * 60 * 24 * 30;
const CHALLENGE_TTL_SEC = Number.parseInt(process.env.WALLET_V2_CHALLENGE_TTL_SEC || '', 10) || 60 * 5;

const IMPORT_FINGERPRINT_LIMIT_PER_DAY = 20;
const IMPORT_FINGERPRINT_WINDOW_MS = 24 * 60 * 60 * 1000;

const importFingerprintAttempts = new Map<string, { count: number; resetAt: number }>();

type DevicePlatform = 'ios' | 'android' | 'web';

type DeviceInput = {
    deviceId: string;
    platform: DevicePlatform;
    biometricSupported: boolean;
    devicePubKey: string | null;
};

class ApiError extends Error {
    public readonly statusCode: number;

    public readonly code: string;

    public readonly details?: Record<string, unknown>;

    constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}

function now(): Date {
    return new Date();
}

function toIsoDate(value: Date | null | undefined): string | null {
    return value ? value.toISOString() : null;
}

function sendError(
    res: Response,
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
) {
    return res.status(statusCode).json({
        success: false,
        error: {
            code,
            message,
        },
        ...(details || {}),
    });
}

function parseDeviceInput(rawDevice: unknown): DeviceInput | null {
    if (!rawDevice || typeof rawDevice !== 'object') {
        return null;
    }

    const candidate = rawDevice as {
        deviceId?: unknown;
        platform?: unknown;
        biometricSupported?: unknown;
        devicePubKey?: unknown;
    };

    const deviceId = typeof candidate.deviceId === 'string' ? candidate.deviceId.trim() : '';
    const platform = typeof candidate.platform === 'string' ? candidate.platform.trim().toLowerCase() : '';
    const biometricSupported = typeof candidate.biometricSupported === 'boolean'
        ? candidate.biometricSupported
        : false;
    const devicePubKey = typeof candidate.devicePubKey === 'string' && candidate.devicePubKey.trim()
        ? candidate.devicePubKey.trim()
        : null;

    if (!deviceId || deviceId.length > 128) {
        return null;
    }

    if (platform !== 'ios' && platform !== 'android' && platform !== 'web') {
        return null;
    }

    return {
        deviceId,
        platform,
        biometricSupported,
        devicePubKey,
    };
}

function parseMnemonicFingerprintBucket(fingerprint: string): { allowed: boolean; retryAfterSec: number } {
    const timestamp = Date.now();
    const existing = importFingerprintAttempts.get(fingerprint);

    if (!existing || existing.resetAt <= timestamp) {
        importFingerprintAttempts.set(fingerprint, {
            count: 1,
            resetAt: timestamp + IMPORT_FINGERPRINT_WINDOW_MS,
        });

        return { allowed: true, retryAfterSec: 0 };
    }

    if (existing.count >= IMPORT_FINGERPRINT_LIMIT_PER_DAY) {
        return {
            allowed: false,
            retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - timestamp) / 1000)),
        };
    }

    existing.count += 1;
    importFingerprintAttempts.set(fingerprint, existing);

    return { allowed: true, retryAfterSec: 0 };
}

function clearMnemonicFingerprintAttempts(fingerprint: string): void {
    importFingerprintAttempts.delete(fingerprint);
}

function ipFromRequest(req: Request): string | undefined {
    const forwarded = req.headers['x-forwarded-for'];

    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0]?.trim();
    }

    return req.ip || req.socket.remoteAddress || undefined;
}

async function createAuditEvent(params: {
    tx?: Prisma.TransactionClient;
    walletId?: string | null;
    userId?: string | null;
    event: string;
    ipHash?: string | null;
    userAgent?: string | null;
    meta?: Prisma.InputJsonValue;
}) {
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

async function ensureUserExists(userId: string, telegramId: number) {
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

async function createUniqueMainAddress(tx: Prisma.TransactionClient, walletId: string): Promise<string> {
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

async function getMainAddress(tx: Prisma.TransactionClient, walletId: string): Promise<string> {
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

async function issueWalletSession(tx: Prisma.TransactionClient, params: {
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

async function cancelPendingTxAndReleaseLocked(
    tx: Prisma.TransactionClient,
    txId: string,
    walletId: string,
    asset: string,
    amount: bigint,
    status: 'canceled' | 'failed',
    timestamp: Date,
) {
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

router.post('/wallet/create', authLimit, requireAuth, async (req, res) => {
    try {
        const userId = req.authUser?.uid;
        const telegramId = req.authUser?.telegramId;
        const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
        const device = parseDeviceInput(req.body?.device);

        if (!userId || typeof telegramId !== 'number') {
            return sendError(res, 401, 'UNAUTHORIZED', 'Authorization token is required');
        }

        if (!isValidPin(pin)) {
            return sendError(res, 400, 'INVALID_PIN', 'PIN format is invalid');
        }

        if (!device) {
            return sendError(res, 400, 'INVALID_DEVICE', 'Device payload is invalid');
        }

        await ensureUserExists(userId, telegramId);

        const existingWallet = await prisma.walletV2.findFirst({
            where: {
                userId,
                status: { not: 'deleted' },
            },
            select: { id: true },
        });

        if (existingWallet?.id) {
            return sendError(res, 409, 'WALLET_ALREADY_EXISTS', 'Wallet already exists for this user');
        }

        const mnemonic = generateMnemonic24Words();
        const mnemonicSalt = generateSalt();
        const pinSalt = generateSalt();
        const walletId = crypto.randomUUID();
        const walletCreatedAt = now();
        const ipHash = hashIpAddress(ipFromRequest(req)) || null;
        const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

        const [normalizedMnemonicHash, pinHash] = await Promise.all([
            hashSecret(mnemonic.normalized, mnemonicSalt),
            hashSecret(pin, pinSalt),
        ]);

        const fingerprint = mnemonicFingerprint(mnemonic.normalized);

        const result = await prisma.$transaction(async (tx) => {
            await tx.walletV2.create({
                data: {
                    id: walletId,
                    userId,
                    mnemonicHash: normalizedMnemonicHash,
                    mnemonicSalt,
                    mnemonicFingerprint: fingerprint,
                    pinHash,
                    pinSalt,
                    status: 'active',
                    createdAt: walletCreatedAt,
                    updatedAt: walletCreatedAt,
                },
            });

            const address = await createUniqueMainAddress(tx, walletId);

            await tx.balanceV2.create({
                data: {
                    walletId,
                    asset: DEFAULT_ASSET,
                    available: 0n,
                    locked: 0n,
                },
            });

            const session = await issueWalletSession(tx, {
                walletId,
                userId,
                device,
                ipHash,
                userAgent,
            });

            await createAuditEvent({
                tx,
                walletId,
                userId,
                event: 'wallet.created',
                ipHash,
                userAgent,
                meta: {
                    deviceId: device.deviceId,
                    platform: device.platform,
                    biometricSupported: device.biometricSupported,
                },
            });

            return {
                address,
                session,
            };
        });

        return res.status(201).json({
            success: true,
            data: {
                wallet: {
                    id: walletId,
                    address: result.address,
                    status: 'active',
                    createdAt: walletCreatedAt.toISOString(),
                },
                mnemonic: mnemonic.words,
                session: {
                    accessToken: result.session.accessToken,
                    refreshToken: result.session.refreshToken,
                    expiresInSec: result.session.expiresInSec,
                },
            },
        });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return sendError(res, 409, 'WALLET_ALREADY_EXISTS', 'Wallet already exists for this user');
        }

        console.error('Wallet v2 create error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create wallet');
    }
});

router.post('/wallet/import', walletV2ImportLimit, requireAuth, async (req, res) => {
    try {
        const userId = req.authUser?.uid;
        const telegramId = req.authUser?.telegramId;
        const newPin = typeof req.body?.newPin === 'string' ? req.body.newPin.trim() : '';
        const device = parseDeviceInput(req.body?.device);

        if (!userId || typeof telegramId !== 'number') {
            return sendError(res, 401, 'UNAUTHORIZED', 'Authorization token is required');
        }

        if (!isValidPin(newPin)) {
            return sendError(res, 400, 'INVALID_PIN', 'PIN format is invalid');
        }

        if (!device) {
            return sendError(res, 400, 'INVALID_DEVICE', 'Device payload is invalid');
        }

        const normalizedMnemonic = parseAndNormalizeMnemonicInput(req.body?.mnemonic);

        if (!normalizedMnemonic) {
            return sendError(res, 401, 'INVALID_MNEMONIC', 'Mnemonic is invalid');
        }

        const fingerprint = mnemonicFingerprint(normalizedMnemonic.normalized);
        const perFingerprintCheck = parseMnemonicFingerprintBucket(fingerprint);

        if (!perFingerprintCheck.allowed) {
            return sendError(
                res,
                429,
                'IMPORT_RATE_LIMITED',
                'Too many import attempts',
                { retryAfterSec: perFingerprintCheck.retryAfterSec },
            );
        }

        const wallet = await prisma.walletV2.findUnique({
            where: { mnemonicFingerprint: fingerprint },
            select: {
                id: true,
                userId: true,
                mnemonicHash: true,
                mnemonicSalt: true,
                status: true,
            },
        });

        if (!wallet) {
            await createAuditEvent({
                walletId: null,
                userId,
                event: 'wallet.import.failed',
                ipHash: hashIpAddress(ipFromRequest(req)) || null,
                userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
                meta: {
                    reason: 'fingerprint_not_found',
                    deviceId: device.deviceId,
                },
            });

            return sendError(res, 401, 'INVALID_MNEMONIC', 'Mnemonic is invalid');
        }

        if (wallet.status === 'blocked') {
            return sendError(res, 423, 'WALLET_BLOCKED', 'Wallet is blocked');
        }

        const mnemonicVerified = await verifySecret(wallet.mnemonicHash, normalizedMnemonic.normalized, wallet.mnemonicSalt);

        if (!mnemonicVerified) {
            await createAuditEvent({
                walletId: wallet.id,
                userId,
                event: 'wallet.import.failed',
                ipHash: hashIpAddress(ipFromRequest(req)) || null,
                userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
                meta: {
                    reason: 'mnemonic_verification_failed',
                    deviceId: device.deviceId,
                },
            });

            return sendError(res, 401, 'INVALID_MNEMONIC', 'Mnemonic is invalid');
        }

        await ensureUserExists(userId, telegramId);

        const newPinSalt = generateSalt();
        const newPinHash = await hashSecret(newPin, newPinSalt);
        const currentTime = now();
        const ipHash = hashIpAddress(ipFromRequest(req)) || null;
        const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

        const result = await prisma.$transaction(async (tx) => {
            await tx.walletV2.update({
                where: { id: wallet.id },
                data: {
                    userId,
                    pinHash: newPinHash,
                    pinSalt: newPinSalt,
                    lastImportAt: currentTime,
                    updatedAt: currentTime,
                },
            });

            const address = await getMainAddress(tx, wallet.id);
            const session = await issueWalletSession(tx, {
                walletId: wallet.id,
                userId,
                device,
                ipHash,
                userAgent,
            });

            await createAuditEvent({
                tx,
                walletId: wallet.id,
                userId,
                event: 'wallet.import.succeeded',
                ipHash,
                userAgent,
                meta: {
                    deviceId: device.deviceId,
                    platform: device.platform,
                },
            });

            return {
                address,
                session,
            };
        });

        clearMnemonicFingerprintAttempts(fingerprint);

        return res.json({
            success: true,
            data: {
                wallet: {
                    id: wallet.id,
                    address: result.address,
                    status: 'active',
                },
                session: {
                    accessToken: result.session.accessToken,
                    refreshToken: result.session.refreshToken,
                    expiresInSec: result.session.expiresInSec,
                },
            },
        });
    } catch (error) {
        console.error('Wallet v2 import error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to import wallet');
    }
});

router.post('/session/refresh', walletV2SessionRefreshLimit, async (req, res) => {
    try {
        const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken.trim() : '';
        const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';

        if (!refreshToken) {
            return sendError(res, 401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
        }

        if (!deviceId) {
            return sendError(res, 400, 'DEVICE_MISMATCH', 'deviceId is required');
        }

        const refreshTokenHashValue = hashRefreshToken(refreshToken);

        const session = await prisma.walletSessionV2.findFirst({
            where: { refreshTokenHash: refreshTokenHashValue },
            select: {
                id: true,
                walletId: true,
                userId: true,
                deviceId: true,
                platform: true,
                status: true,
                refreshTokenExpiresAt: true,
                wallet: {
                    select: {
                        status: true,
                    },
                },
            },
        });

        if (!session) {
            return sendError(res, 401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
        }

        if (session.deviceId !== deviceId) {
            return sendError(res, 409, 'DEVICE_MISMATCH', 'Device does not match session');
        }

        if (session.status !== 'active' || session.refreshTokenExpiresAt.getTime() <= Date.now()) {
            return sendError(res, 423, 'SESSION_REVOKED', 'Session is revoked or expired');
        }

        if (session.wallet.status === 'blocked') {
            return sendError(res, 423, 'WALLET_BLOCKED', 'Wallet is blocked');
        }

        const currentTime = now();
        const newRefreshToken = generateOpaqueRefreshToken();
        const newRefreshTokenHash = hashRefreshToken(newRefreshToken);
        const newRefreshExpiresAt = new Date(currentTime.getTime() + REFRESH_TOKEN_TTL_SEC * 1000);
        const ipHash = hashIpAddress(ipFromRequest(req)) || null;
        const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

        await prisma.walletSessionV2.update({
            where: { id: session.id },
            data: {
                refreshTokenHash: newRefreshTokenHash,
                refreshTokenExpiresAt: newRefreshExpiresAt,
                lastSeenAt: currentTime,
                lastIpHash: ipHash,
                userAgent,
            },
        });

        const accessToken = signWalletV2AccessToken({
            sid: session.id,
            wid: session.walletId,
            uid: session.userId || undefined,
            did: session.deviceId,
            platform: session.platform as DevicePlatform,
        });

        await createAuditEvent({
            walletId: session.walletId,
            userId: session.userId,
            event: 'session.refreshed',
            ipHash,
            userAgent,
            meta: {
                sessionId: session.id,
                deviceId: session.deviceId,
            },
        });

        return res.json({
            success: true,
            data: {
                session: {
                    accessToken,
                    refreshToken: newRefreshToken,
                    expiresInSec: walletV2AccessTokenTtlSec(),
                },
            },
        });
    } catch (error) {
        console.error('Wallet v2 session refresh error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to refresh session');
    }
});

router.post('/session/logout', walletV2SessionLogoutLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken.trim() : '';

        if (!refreshToken) {
            return sendError(res, 401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
        }

        const sessionId = req.walletV2Auth!.sessionId;
        const session = await prisma.walletSessionV2.findUnique({
            where: { id: sessionId },
            select: {
                id: true,
                walletId: true,
                userId: true,
                refreshTokenHash: true,
                status: true,
                deviceId: true,
            },
        });

        if (!session) {
            return sendError(res, 401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
        }

        if (session.refreshTokenHash !== hashRefreshToken(refreshToken)) {
            return sendError(res, 401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
        }

        if (session.status === 'active') {
            await prisma.walletSessionV2.update({
                where: { id: session.id },
                data: {
                    status: 'revoked',
                    revokedAt: now(),
                    revokedReason: 'logout',
                },
            });
        }

        await createAuditEvent({
            walletId: session.walletId,
            userId: session.userId,
            event: 'session.revoked',
            ipHash: hashIpAddress(ipFromRequest(req)) || null,
            userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
            meta: {
                sessionId: session.id,
                reason: 'logout',
                deviceId: session.deviceId,
            },
        });

        return res.json({
            success: true,
            data: {
                revoked: true,
            },
        });
    } catch (error) {
        console.error('Wallet v2 session logout error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to revoke session');
    }
});

router.get('/sessions', standardLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const walletId = req.walletV2Auth!.walletId;
        const currentSessionId = req.walletV2Auth!.sessionId;

        const sessions = await prisma.walletSessionV2.findMany({
            where: { walletId },
            orderBy: [
                { status: 'asc' },
                { createdAt: 'desc' },
            ],
            take: 30,
            select: {
                id: true,
                deviceId: true,
                platform: true,
                biometricSupported: true,
                status: true,
                createdAt: true,
                lastSeenAt: true,
            },
        });

        return res.json({
            success: true,
            data: {
                sessions: sessions.map((session) => ({
                    id: session.id,
                    deviceId: session.deviceId,
                    platform: session.platform,
                    biometricSupported: session.biometricSupported,
                    status: session.status,
                    createdAt: session.createdAt.toISOString(),
                    lastSeenAt: session.lastSeenAt.toISOString(),
                    isCurrent: session.id === currentSessionId,
                })),
            },
        });
    } catch (error) {
        console.error('Wallet v2 sessions list error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch sessions');
    }
});

router.post('/sessions/revoke', walletV2SessionsRevokeLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const targetSessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
        const walletId = req.walletV2Auth!.walletId;
        const currentSessionId = req.walletV2Auth!.sessionId;

        if (!targetSessionId) {
            return sendError(res, 400, 'SESSION_ID_REQUIRED', 'sessionId is required');
        }

        if (targetSessionId === currentSessionId) {
            return sendError(res, 400, 'SELF_REVOKE_NOT_ALLOWED', 'Use /v2/session/logout to revoke current session');
        }

        const revokeResult = await prisma.walletSessionV2.updateMany({
            where: {
                id: targetSessionId,
                walletId,
                status: 'active',
            },
            data: {
                status: 'revoked',
                revokedAt: now(),
                revokedReason: 'manual_revoke',
            },
        });

        if (revokeResult.count !== 1) {
            return sendError(res, 404, 'SESSION_NOT_FOUND', 'Session not found');
        }

        await createAuditEvent({
            walletId,
            userId: req.walletV2Auth?.userId,
            event: 'session.revoked',
            ipHash: hashIpAddress(ipFromRequest(req)) || null,
            userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
            meta: {
                sessionId: targetSessionId,
                reason: 'manual_revoke',
            },
        });

        return res.json({
            success: true,
            data: {
                revoked: true,
            },
        });
    } catch (error) {
        console.error('Wallet v2 session revoke error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to revoke session');
    }
});

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
                address: mainAddress.address,
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

router.post('/tx/create', strictLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const walletId = typeof req.body?.walletId === 'string' ? req.body.walletId.trim() : '';
        const toAddress = typeof req.body?.toAddress === 'string' ? req.body.toAddress.trim().toUpperCase() : '';
        const asset = typeof req.body?.asset === 'string' ? req.body.asset.trim().toUpperCase() : '';
        const amount = parseAmountToBigInt(req.body?.amount);
        const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
        const metadata = req.body?.meta && typeof req.body.meta === 'object'
            ? req.body.meta as Prisma.InputJsonValue
            : undefined;

        if (walletId !== req.walletV2Auth!.walletId) {
            return sendError(res, 403, 'FORBIDDEN', 'Wallet access denied');
        }

        if (!WALLET_V2_ADDRESS_REGEX.test(toAddress)) {
            return sendError(res, 400, 'INVALID_ADDRESS', 'Address format is invalid');
        }

        if (!asset || !VALID_ASSET_REGEX.test(asset)) {
            return sendError(res, 400, 'INVALID_ASSET', 'Asset is invalid');
        }

        if (!amount) {
            return sendError(res, 400, 'INVALID_AMOUNT', 'Amount must be a positive integer string');
        }

        if (!idempotencyKey || !VALID_IDEMPOTENCY_KEY_REGEX.test(idempotencyKey)) {
            return sendError(res, 400, 'INVALID_IDEMPOTENCY_KEY', 'idempotencyKey is required');
        }

        const currentSessionId = req.walletV2Auth!.sessionId;
        const currentTime = now();
        const ipHash = hashIpAddress(ipFromRequest(req)) || null;
        const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

        const txResult = await prisma.$transaction(async (tx) => {
            const existingTx = await tx.txV2.findUnique({
                where: {
                    idempotencyKey,
                },
                select: {
                    id: true,
                    walletId: true,
                    fromAddress: true,
                    toAddress: true,
                    asset: true,
                    amount: true,
                    status: true,
                    createdAt: true,
                },
            });

            if (existingTx) {
                if (existingTx.walletId !== walletId) {
                    throw new ApiError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'idempotencyKey belongs to another wallet');
                }

                if (existingTx.status !== 'pending_confirmation') {
                    throw new ApiError(409, 'TX_ALREADY_FINALIZED', 'Transaction is already finalized');
                }

                const existingChallenge = await tx.txChallengeV2.findFirst({
                    where: {
                        txId: existingTx.id,
                        sessionId: currentSessionId,
                        status: 'active',
                        expiresAt: { gt: currentTime },
                    },
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        expiresAt: true,
                    },
                });

                if (existingChallenge) {
                    return {
                        created: false,
                        tx: existingTx,
                        challenge: existingChallenge,
                    };
                }

                const challengeId = crypto.randomUUID();
                const challengeNonce = generateChallengeNonce();
                const challenge = await tx.txChallengeV2.create({
                    data: {
                        id: challengeId,
                        txId: existingTx.id,
                        sessionId: currentSessionId,
                        nonceHash: hashChallengeNonce(challengeNonce),
                        status: 'active',
                        expiresAt: new Date(currentTime.getTime() + CHALLENGE_TTL_SEC * 1000),
                        attempts: 0,
                        maxAttempts: 5,
                    },
                    select: {
                        id: true,
                        expiresAt: true,
                    },
                });

                return {
                    created: false,
                    tx: existingTx,
                    challenge,
                };
            }

            const senderAddress = await getMainAddress(tx, walletId);
            const recipientAddress = await tx.addressV2.findFirst({
                where: {
                    address: toAddress,
                    status: 'active',
                },
                select: {
                    walletId: true,
                },
            });

            if (!recipientAddress?.walletId) {
                throw new ApiError(404, 'RECIPIENT_NOT_FOUND', 'Recipient wallet not found');
            }

            const debitResult = await tx.balanceV2.updateMany({
                where: {
                    walletId,
                    asset,
                    available: { gte: amount },
                },
                data: {
                    available: { decrement: amount },
                    locked: { increment: amount },
                    updatedAt: currentTime,
                },
            });

            if (debitResult.count !== 1) {
                throw new ApiError(400, 'INSUFFICIENT_BALANCE', 'Insufficient available balance');
            }

            const createdTx = await tx.txV2.create({
                data: {
                    id: crypto.randomUUID(),
                    walletId,
                    fromAddress: senderAddress,
                    toAddress,
                    asset,
                    amount,
                    status: 'pending_confirmation',
                    meta: metadata,
                    idempotencyKey,
                    createdAt: currentTime,
                },
                select: {
                    id: true,
                    walletId: true,
                    fromAddress: true,
                    toAddress: true,
                    asset: true,
                    amount: true,
                    status: true,
                    createdAt: true,
                },
            });

            const challengeId = crypto.randomUUID();
            const challengeNonce = generateChallengeNonce();
            const challenge = await tx.txChallengeV2.create({
                data: {
                    id: challengeId,
                    txId: createdTx.id,
                    sessionId: currentSessionId,
                    nonceHash: hashChallengeNonce(challengeNonce),
                    status: 'active',
                    expiresAt: new Date(currentTime.getTime() + CHALLENGE_TTL_SEC * 1000),
                    attempts: 0,
                    maxAttempts: 5,
                },
                select: {
                    id: true,
                    expiresAt: true,
                },
            });

            await createAuditEvent({
                tx,
                walletId,
                userId: req.walletV2Auth?.userId,
                event: 'tx.created',
                ipHash,
                userAgent,
                meta: {
                    txId: createdTx.id,
                    asset,
                    amount: amount.toString(),
                    toAddress,
                    idempotencyKey,
                },
            });

            return {
                created: true,
                tx: createdTx,
                challenge,
            };
        });

        return res.status(txResult.created ? 201 : 200).json({
            success: true,
            data: {
                tx: {
                    id: txResult.tx.id,
                    status: txResult.tx.status,
                    fromAddress: txResult.tx.fromAddress,
                    toAddress: txResult.tx.toAddress,
                    asset: txResult.tx.asset,
                    amount: txResult.tx.amount.toString(),
                    createdAt: txResult.tx.createdAt.toISOString(),
                },
                challenge: {
                    challengeId: txResult.challenge.id,
                    expiresAt: txResult.challenge.expiresAt.toISOString(),
                    methods: ['biometric', 'pin'],
                },
            },
        });
    } catch (error) {
        if (error instanceof ApiError) {
            return sendError(res, error.statusCode, error.code, error.message, error.details);
        }

        console.error('Wallet v2 tx create error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create transaction');
    }
});

router.post('/tx/confirm', strictLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const txId = typeof req.body?.txId === 'string' ? req.body.txId.trim() : '';
        const challengeId = typeof req.body?.challengeId === 'string' ? req.body.challengeId.trim() : '';
        const authPayload = req.body?.auth;

        if (!txId || !challengeId || !authPayload || typeof authPayload !== 'object') {
            return sendError(res, 400, 'INVALID_REQUEST', 'txId, challengeId, auth are required');
        }

        const authMethod = (authPayload as { method?: unknown }).method;

        if (authMethod !== 'pin' && authMethod !== 'biometric') {
            return sendError(res, 400, 'INVALID_AUTH_METHOD', 'Unsupported auth method');
        }

        const walletId = req.walletV2Auth!.walletId;
        const sessionId = req.walletV2Auth!.sessionId;
        const currentTime = now();
        const ipHash = hashIpAddress(ipFromRequest(req)) || null;
        const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

        const confirmedTx = await prisma.$transaction(async (tx) => {
            const txRecord = await tx.txV2.findUnique({
                where: { id: txId },
                select: {
                    id: true,
                    walletId: true,
                    toAddress: true,
                    asset: true,
                    amount: true,
                    status: true,
                    completedAt: true,
                },
            });

            if (!txRecord || txRecord.walletId !== walletId) {
                throw new ApiError(404, 'TX_NOT_FOUND', 'Transaction not found');
            }

            if (txRecord.status === 'completed') {
                return txRecord;
            }

            if (txRecord.status !== 'pending_confirmation') {
                throw new ApiError(409, 'TX_NOT_PENDING', 'Transaction is not pending confirmation');
            }

            const challenge = await tx.txChallengeV2.findUnique({
                where: { id: challengeId },
                select: {
                    id: true,
                    txId: true,
                    sessionId: true,
                    status: true,
                    expiresAt: true,
                    attempts: true,
                    maxAttempts: true,
                },
            });

            if (!challenge || challenge.txId !== txRecord.id) {
                throw new ApiError(404, 'CHALLENGE_NOT_FOUND', 'Challenge not found');
            }

            if (challenge.sessionId !== sessionId) {
                throw new ApiError(409, 'SESSION_MISMATCH', 'Challenge does not belong to current session');
            }

            if (challenge.status !== 'active') {
                throw new ApiError(423, 'CHALLENGE_INACTIVE', 'Challenge is not active');
            }

            if (challenge.expiresAt.getTime() <= currentTime.getTime()) {
                await tx.txChallengeV2.update({
                    where: { id: challenge.id },
                    data: {
                        status: 'expired',
                    },
                });

                await cancelPendingTxAndReleaseLocked(
                    tx,
                    txRecord.id,
                    txRecord.walletId,
                    txRecord.asset,
                    txRecord.amount,
                    'canceled',
                    currentTime,
                );

                throw new ApiError(410, 'CHALLENGE_EXPIRED', 'Challenge expired');
            }

            const session = await tx.walletSessionV2.findUnique({
                where: { id: sessionId },
                select: {
                    id: true,
                    status: true,
                    deviceId: true,
                    devicePubkey: true,
                    wallet: {
                        select: {
                            pinHash: true,
                            pinSalt: true,
                            status: true,
                            userId: true,
                        },
                    },
                },
            });

            if (!session || session.status !== 'active') {
                throw new ApiError(423, 'SESSION_REVOKED', 'Session is revoked or expired');
            }

            if (session.wallet.status === 'blocked') {
                throw new ApiError(423, 'WALLET_BLOCKED', 'Wallet is blocked');
            }

            let authValid = false;

            if (authMethod === 'pin') {
                const pin = typeof (authPayload as { pin?: unknown }).pin === 'string'
                    ? (authPayload as { pin: string }).pin.trim()
                    : '';

                if (!isValidPin(pin)) {
                    throw new ApiError(400, 'INVALID_PIN', 'PIN format is invalid');
                }

                authValid = await verifySecret(session.wallet.pinHash, pin, session.wallet.pinSalt);
            } else {
                const deviceId = typeof (authPayload as { deviceId?: unknown }).deviceId === 'string'
                    ? (authPayload as { deviceId: string }).deviceId.trim()
                    : '';
                const signature = typeof (authPayload as { signature?: unknown }).signature === 'string'
                    ? (authPayload as { signature: string }).signature.trim()
                    : '';

                if (!deviceId || !signature) {
                    throw new ApiError(400, 'INVALID_BIOMETRIC', 'Biometric payload is invalid');
                }

                if (deviceId !== session.deviceId) {
                    throw new ApiError(409, 'DEVICE_MISMATCH', 'Device does not match current session');
                }

                if (!session.devicePubkey) {
                    throw new ApiError(401, 'INVALID_BIOMETRIC', 'Biometric authentication is not configured');
                }

                authValid = verifyEd25519Signature(
                    session.devicePubkey,
                    signature,
                    buildChallengeMessage(txId, challengeId),
                );
            }

            if (!authValid) {
                const updatedChallenge = await tx.txChallengeV2.update({
                    where: { id: challenge.id },
                    data: {
                        attempts: { increment: 1 },
                    },
                    select: {
                        attempts: true,
                        maxAttempts: true,
                    },
                });

                if (updatedChallenge.attempts >= updatedChallenge.maxAttempts) {
                    await tx.txChallengeV2.update({
                        where: { id: challenge.id },
                        data: {
                            status: 'canceled',
                            consumedAt: currentTime,
                        },
                    });

                    await cancelPendingTxAndReleaseLocked(
                        tx,
                        txRecord.id,
                        txRecord.walletId,
                        txRecord.asset,
                        txRecord.amount,
                        'canceled',
                        currentTime,
                    );

                    throw new ApiError(429, 'PIN_ATTEMPTS_EXCEEDED', 'Too many failed confirmation attempts');
                }

                throw new ApiError(
                    401,
                    authMethod === 'pin' ? 'INVALID_PIN' : 'INVALID_BIOMETRIC',
                    authMethod === 'pin' ? 'PIN is invalid' : 'Biometric signature is invalid',
                    {
                        remainingAttempts: updatedChallenge.maxAttempts - updatedChallenge.attempts,
                    },
                );
            }

            const senderLockedUpdate = await tx.balanceV2.updateMany({
                where: {
                    walletId: txRecord.walletId,
                    asset: txRecord.asset,
                    locked: { gte: txRecord.amount },
                },
                data: {
                    locked: { decrement: txRecord.amount },
                    updatedAt: currentTime,
                },
            });

            if (senderLockedUpdate.count !== 1) {
                await cancelPendingTxAndReleaseLocked(
                    tx,
                    txRecord.id,
                    txRecord.walletId,
                    txRecord.asset,
                    txRecord.amount,
                    'failed',
                    currentTime,
                );

                throw new ApiError(409, 'LEDGER_CONFLICT', 'Failed to finalize transaction ledger changes');
            }

            const recipientAddress = await tx.addressV2.findFirst({
                where: {
                    address: txRecord.toAddress,
                    status: 'active',
                },
                select: {
                    walletId: true,
                },
            });

            if (!recipientAddress) {
                await cancelPendingTxAndReleaseLocked(
                    tx,
                    txRecord.id,
                    txRecord.walletId,
                    txRecord.asset,
                    txRecord.amount,
                    'failed',
                    currentTime,
                );

                throw new ApiError(404, 'RECIPIENT_NOT_FOUND', 'Recipient wallet not found');
            }

            await tx.balanceV2.upsert({
                where: {
                    walletId_asset: {
                        walletId: recipientAddress.walletId,
                        asset: txRecord.asset,
                    },
                },
                update: {
                    available: { increment: txRecord.amount },
                    updatedAt: currentTime,
                },
                create: {
                    walletId: recipientAddress.walletId,
                    asset: txRecord.asset,
                    available: txRecord.amount,
                    locked: 0n,
                    updatedAt: currentTime,
                },
            });

            const finalizedTx = await tx.txV2.update({
                where: { id: txRecord.id },
                data: {
                    status: 'completed',
                    confirmedAt: currentTime,
                    completedAt: currentTime,
                },
                select: {
                    id: true,
                    status: true,
                    completedAt: true,
                    walletId: true,
                },
            });

            await tx.txChallengeV2.update({
                where: { id: challenge.id },
                data: {
                    status: 'consumed',
                    consumedAt: currentTime,
                },
            });

            await tx.walletSessionV2.update({
                where: { id: sessionId },
                data: {
                    lastSeenAt: currentTime,
                    lastIpHash: ipHash,
                    userAgent,
                },
            });

            await createAuditEvent({
                tx,
                walletId: txRecord.walletId,
                userId: req.walletV2Auth?.userId,
                event: 'tx.confirmed',
                ipHash,
                userAgent,
                meta: {
                    txId: txRecord.id,
                    method: authMethod,
                    sessionId,
                },
            });

            return finalizedTx;
        });

        return res.json({
            success: true,
            data: {
                tx: {
                    id: confirmedTx.id,
                    status: confirmedTx.status,
                    completedAt: toIsoDate(confirmedTx.completedAt),
                },
            },
        });
    } catch (error) {
        if (error instanceof ApiError) {
            return sendError(res, error.statusCode, error.code, error.message, error.details);
        }

        console.error('Wallet v2 tx confirm error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to confirm transaction');
    }
});

export default router;
