import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { Request, Response, Router } from 'express';

import { walletV2AccessTokenTtlSec, signWalletV2AccessToken } from '../lib/auth/walletV2Jwt';
import { prisma } from '../lib/db/prisma';
import {
    buildWalletV2AddressCandidates,
    buildChallengeMessage,
    formatWalletV2AddressForNetwork,
    generateAddressV2,
    generateChallengeNonce,
    generateMnemonic24Words,
    generateOpaqueRefreshToken,
    generateSalt,
    getWalletV2AddressPrefix,
    getWalletV2AddressRegex,
    getWalletV2Network,
    hashChallengeNonce,
    hashIpAddress,
    hashRefreshToken,
    hashSecret,
    isValidPin,
    mnemonicFingerprint,
    normalizeWalletV2Address,
    WALLET_V2_ADDRESS_BODY_LENGTH,
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
const WALLET_V2_NETWORK = getWalletV2Network();
const WALLET_V2_ADDRESS_PREFIX = getWalletV2AddressPrefix(WALLET_V2_NETWORK);
const WALLET_V2_ADDRESS_REGEX_CURRENT = getWalletV2AddressRegex(WALLET_V2_NETWORK);
const WALLET_V2_ADDRESS_PLACEHOLDER_BODY = 'X'.repeat(WALLET_V2_ADDRESS_BODY_LENGTH);
const WALLET_V2_TESTNET_FAUCET_ADDRESS = `${WALLET_V2_ADDRESS_PREFIX}-${'F'.repeat(WALLET_V2_ADDRESS_BODY_LENGTH)}`;
const WALLET_V2_STAKING_REWARD_SOURCE_ADDRESS = `${WALLET_V2_ADDRESS_PREFIX}-${'S'.repeat(WALLET_V2_ADDRESS_BODY_LENGTH)}`;
const WALLET_V2_TESTNET_TOPUP_MAX_AMOUNT = 1_000_000_000n;
const MAX_WALLETS_PER_USER = 10;
const NFT_STAKING_REWARD_ASSET = DEFAULT_ASSET;
const NFT_STAKING_UNSTAKE_COOLDOWN_HOURS = Math.max(
    1,
    Number.parseInt(process.env.WALLET_V2_NFT_STAKING_UNSTAKE_COOLDOWN_HOURS || '', 10) || 24,
);
const NFT_STAKING_WINDOW_START_HOURS = Math.max(
    1,
    Number.parseInt(process.env.WALLET_V2_NFT_STAKING_WINDOW_START_HOURS || '', 10) || 24,
);
const NFT_STAKING_WINDOW_END_HOURS = Math.max(
    NFT_STAKING_WINDOW_START_HOURS + 1,
    Number.parseInt(process.env.WALLET_V2_NFT_STAKING_WINDOW_END_HOURS || '', 10) || 48,
);
const NFT_STAKING_REWARD_PER_HOUR_BY_RARITY: Record<string, bigint> = {
    legendary: 120n,
    rare: 60n,
    common: 30n,
};
const NFT_STAKING_DEFAULT_REWARD_PER_HOUR = 20n;
const DEFAULT_COLLECTION_NAME = 'Plush pepe';

const IMPORT_FINGERPRINT_LIMIT_PER_DAY = 20;
const IMPORT_FINGERPRINT_WINDOW_MS = 24 * 60 * 60 * 1000;

const PIN_VERIFY_MAX_FAILURES = 5;
const PIN_VERIFY_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

type DevicePlatform = 'ios' | 'android' | 'web';

type DeviceInput = {
    deviceId: string;
    platform: DevicePlatform;
    biometricSupported: boolean;
    devicePubKey: string | null;
};

type WalletV2PinRecord = {
    walletId: string;
    pinHash: string;
    pinSalt: string;
};

type WalletV2PinLookupClient = {
    walletV2: Prisma.TransactionClient['walletV2'];
};

type WalletNftOwnershipContext = {
    userId: string | null;
    mainAddress: string;
};

type NftStakingWindow = {
    opensAt: Date;
    closesAt: Date;
    canStake: boolean;
    reason: 'open' | 'not_open' | 'closed';
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

function formatWalletAddress(value: string): string {
    return formatWalletV2AddressForNetwork(value, WALLET_V2_NETWORK);
}

function classifyWalletV2Tx(params: {
    walletId: string;
    ownAddress: string;
    tx: {
        walletId: string;
        fromAddress: string;
        toAddress: string;
        meta: Prisma.JsonValue | null;
    };
}): { type: 'send' | 'receive' | 'topup'; direction: 'in' | 'out' } {
    const { walletId, ownAddress, tx } = params;
    const meta = tx.meta;
    const metaSource = (
        meta
        && typeof meta === 'object'
        && !Array.isArray(meta)
        && typeof (meta as { source?: unknown }).source === 'string'
    )
        ? (meta as { source: string }).source.trim().toLowerCase()
        : '';

    if (
        metaSource === 'testnet_faucet'
        || metaSource === 'nft_staking_reward'
        || tx.fromAddress === WALLET_V2_TESTNET_FAUCET_ADDRESS
        || tx.fromAddress === WALLET_V2_STAKING_REWARD_SOURCE_ADDRESS
    ) {
        return { type: 'topup', direction: 'in' };
    }

    if (tx.toAddress === ownAddress && (tx.walletId !== walletId || tx.fromAddress !== ownAddress)) {
        return { type: 'receive', direction: 'in' };
    }

    return { type: 'send', direction: 'out' };
}

function addHours(date: Date, hours: number): Date {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
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

function resolveNftStakingRewardPerHour(rarityInput: string | null | undefined): bigint {
    const rarity = (rarityInput || '').trim().toLowerCase();

    if (rarity && NFT_STAKING_REWARD_PER_HOUR_BY_RARITY[rarity] !== undefined) {
        return NFT_STAKING_REWARD_PER_HOUR_BY_RARITY[rarity];
    }

    return NFT_STAKING_DEFAULT_REWARD_PER_HOUR;
}

function buildStakeWindow(anchorAt: Date, currentTime: Date): NftStakingWindow {
    const opensAt = addHours(anchorAt, NFT_STAKING_WINDOW_START_HOURS);
    const closesAt = addHours(anchorAt, NFT_STAKING_WINDOW_END_HOURS);

    if (currentTime.getTime() < opensAt.getTime()) {
        return {
            opensAt,
            closesAt,
            canStake: false,
            reason: 'not_open',
        };
    }

    if (currentTime.getTime() > closesAt.getTime()) {
        return {
            opensAt,
            closesAt,
            canStake: false,
            reason: 'closed',
        };
    }

    return {
        opensAt,
        closesAt,
        canStake: true,
        reason: 'open',
    };
}

function computeNftStakingPendingReward(params: {
    lastClaimAt: Date;
    rewardPerHour: bigint;
    currentTime: Date;
}): {
    amount: bigint;
    elapsedWholeHours: number;
    nextClaimAt: Date;
} {
    const elapsedMs = params.currentTime.getTime() - params.lastClaimAt.getTime();
    const elapsedWholeHours = elapsedMs > 0
        ? Math.floor(elapsedMs / (60 * 60 * 1000))
        : 0;

    return {
        amount: BigInt(elapsedWholeHours) * params.rewardPerHour,
        elapsedWholeHours,
        nextClaimAt: addHours(params.lastClaimAt, 1),
    };
}

function isNftOwnedByWallet(params: {
    nftOwnerId: string | null;
    nftOwnerWallet: string | null;
    ownership: WalletNftOwnershipContext;
}): boolean {
    if (params.nftOwnerWallet && params.nftOwnerWallet === params.ownership.mainAddress) {
        return true;
    }

    if (params.ownership.userId && params.nftOwnerId && params.nftOwnerId === params.ownership.userId) {
        return true;
    }

    return false;
}

function buildNftOwnershipWhere(ownership: WalletNftOwnershipContext): Prisma.NftWhereInput {
    const or: Prisma.NftWhereInput[] = [
        { ownerWallet: ownership.mainAddress },
    ];

    if (ownership.userId) {
        or.push({ ownerId: ownership.userId });
    }

    if (or.length === 1) {
        return or[0];
    }

    return { OR: or };
}

async function resolveWalletNftStakingContext(tx: Prisma.TransactionClient, walletId: string): Promise<{
    walletId: string;
    userId: string | null;
    mainAddress: string;
}> {
    const wallet = await tx.walletV2.findUnique({
        where: { id: walletId },
        select: {
            id: true,
            userId: true,
            status: true,
        },
    });

    if (!wallet) {
        throw new ApiError(404, 'WALLET_NOT_FOUND', 'Wallet not found');
    }

    if (wallet.status !== 'active') {
        throw new ApiError(423, 'WALLET_BLOCKED', 'Wallet is blocked');
    }

    const mainAddress = await getMainAddress(tx, walletId);

    return {
        walletId: wallet.id,
        userId: wallet.userId,
        mainAddress,
    };
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

function assertNftStakingPrismaClientReady(): void {
    const stakingDelegate = (prisma as unknown as { nftStakingV2?: unknown }).nftStakingV2;

    if (stakingDelegate !== undefined) {
        return;
    }

    throw new ApiError(
        503,
        'NFT_STAKING_SCHEMA_NOT_READY',
        'NFT staking database schema is not initialized',
        {
            hint: 'Run Prisma migrations and regenerate client (npx prisma migrate deploy && npx prisma generate), then restart backend',
        },
    );
}

function handleNftStakingSchemaNotReadyError(params: {
    res: Response;
    error: unknown;
    context: string;
}): Response | null {
    const { res, error, context } = params;

    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
        return null;
    }

    if (error.code !== 'P2021' && error.code !== 'P2022') {
        return null;
    }

    console.error(`${context} schema error:`, {
        code: error.code,
        meta: error.meta,
    });

    return sendError(
        res,
        503,
        'NFT_STAKING_SCHEMA_NOT_READY',
        'NFT staking database schema is not initialized',
        {
            hint: 'Run Prisma migrations and regenerate client (npx prisma migrate deploy && npx prisma generate), then restart backend',
        },
    );
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

async function checkFingerprintAttemptDb(fingerprint: string): Promise<{ allowed: boolean; retryAfterSec: number }> {
    const windowStart = new Date(Date.now() - IMPORT_FINGERPRINT_WINDOW_MS);

    const result = await prisma.$queryRaw<[{ count: bigint }]>(
        Prisma.sql`
            SELECT COUNT(*) AS count
            FROM audit_events_v2
            WHERE event = 'wallet.import.fingerprint_attempt'
              AND (meta->>'fingerprint') = ${fingerprint}
              AND created_at >= ${windowStart}
        `,
    );

    const count = Number(result[0]?.count ?? 0n);

    if (count >= IMPORT_FINGERPRINT_LIMIT_PER_DAY) {
        const oldestResult = await prisma.$queryRaw<[{ oldest_at: Date | null }]>(
            Prisma.sql`
                SELECT MIN(created_at) AS oldest_at
                FROM audit_events_v2
                WHERE event = 'wallet.import.fingerprint_attempt'
                  AND (meta->>'fingerprint') = ${fingerprint}
                  AND created_at >= ${windowStart}
            `,
        );
        const oldestAt = oldestResult[0]?.oldest_at;
        const retryAfterSec = oldestAt
            ? Math.max(1, Math.ceil((oldestAt.getTime() + IMPORT_FINGERPRINT_WINDOW_MS - Date.now()) / 1000))
            : Math.ceil(IMPORT_FINGERPRINT_WINDOW_MS / 1000);

        return { allowed: false, retryAfterSec };
    }

    return { allowed: true, retryAfterSec: 0 };
}

async function recordFingerprintAttemptDb(fingerprint: string): Promise<void> {
    await prisma.auditEventV2.create({
        data: {
            id: crypto.randomUUID(),
            event: 'wallet.import.fingerprint_attempt',
            meta: { fingerprint },
        },
    });
}

// Use req.ip — Express resolves this correctly based on `trust proxy` setting,
// preventing spoofing via X-Forwarded-For injection.
function ipFromRequest(req: Request): string | undefined {
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

async function getLatestGlobalPinRecord(
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

async function applyGlobalPinToUserWallets(
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

async function creditNftStakingReward(
    tx: Prisma.TransactionClient,
    params: {
        walletId: string;
        tokenId: string;
        amount: bigint;
        mainAddress: string;
        currentTime: Date;
    },
) {
    if (params.amount <= 0n) {
        return null;
    }

    const creditedBalance = await tx.balanceV2.upsert({
        where: {
            walletId_asset: {
                walletId: params.walletId,
                asset: NFT_STAKING_REWARD_ASSET,
            },
        },
        update: {
            available: { increment: params.amount },
            updatedAt: params.currentTime,
        },
        create: {
            walletId: params.walletId,
            asset: NFT_STAKING_REWARD_ASSET,
            available: params.amount,
            locked: 0n,
            updatedAt: params.currentTime,
        },
        select: {
            asset: true,
            available: true,
            locked: true,
            updatedAt: true,
        },
    });

    const rewardTx = await tx.txV2.create({
        data: {
            id: crypto.randomUUID(),
            walletId: params.walletId,
            fromAddress: WALLET_V2_STAKING_REWARD_SOURCE_ADDRESS,
            toAddress: params.mainAddress,
            asset: NFT_STAKING_REWARD_ASSET,
            amount: params.amount,
            status: 'completed',
            meta: {
                source: 'nft_staking_reward',
                tokenId: params.tokenId,
            },
            createdAt: params.currentTime,
            confirmedAt: params.currentTime,
            completedAt: params.currentTime,
        },
        select: {
            id: true,
            status: true,
            fromAddress: true,
            toAddress: true,
            asset: true,
            amount: true,
            createdAt: true,
            completedAt: true,
        },
    });

    return {
        creditedBalance,
        rewardTx,
    };
}

router.post('/wallet/create', authLimit, requireAuth, async (req, res) => {
    try {
        const userId = req.authUser?.uid;
        const telegramId = req.authUser?.telegramId;
        const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
        const hasPinInput = Boolean(pin);
        const device = parseDeviceInput(req.body?.device);

        if (!userId || typeof telegramId !== 'number') {
            return sendError(res, 401, 'UNAUTHORIZED', 'Authorization token is required');
        }

        if (hasPinInput && !isValidPin(pin)) {
            return sendError(res, 400, 'INVALID_PIN', 'PIN format is invalid');
        }

        if (!device) {
            return sendError(res, 400, 'INVALID_DEVICE', 'Device payload is invalid');
        }

        await ensureUserExists(userId, telegramId);

        const existingWalletCount = await prisma.walletV2.count({
            where: {
                userId,
                status: { not: 'deleted' },
            },
        });

        if (existingWalletCount >= MAX_WALLETS_PER_USER) {
            return sendError(
                res,
                409,
                'WALLET_LIMIT_REACHED',
                `Wallet limit reached (${MAX_WALLETS_PER_USER})`,
                { limit: MAX_WALLETS_PER_USER },
            );
        }

        let pinHash: string;
        let pinSalt: string;
        let shouldPropagateGlobalPin = false;

        if (existingWalletCount === 0) {
            if (!isValidPin(pin)) {
                return sendError(res, 400, 'INVALID_PIN', 'PIN format is invalid');
            }

            pinSalt = generateSalt();
            pinHash = await hashSecret(pin, pinSalt);
        } else if (hasPinInput) {
            pinSalt = generateSalt();
            pinHash = await hashSecret(pin, pinSalt);
            shouldPropagateGlobalPin = true;
        } else {
            const existingGlobalPin = await getLatestGlobalPinRecord(prisma, { userId });

            if (!existingGlobalPin) {
                return sendError(res, 409, 'PIN_NOT_CONFIGURED', 'Global PIN is not configured');
            }

            pinHash = existingGlobalPin.pinHash;
            pinSalt = existingGlobalPin.pinSalt;
        }

        const mnemonic = generateMnemonic24Words();
        const mnemonicSalt = generateSalt();
        const walletId = crypto.randomUUID();
        const walletCreatedAt = now();
        const ipHash = hashIpAddress(ipFromRequest(req)) || null;
        const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

        const normalizedMnemonicHash = await hashSecret(mnemonic.normalized, mnemonicSalt);

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

            if (shouldPropagateGlobalPin) {
                await applyGlobalPinToUserWallets(
                    tx,
                    userId,
                    pinHash,
                    pinSalt,
                    walletCreatedAt,
                );
            }

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
                    address: formatWalletAddress(result.address),
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
            return sendError(res, 409, 'WALLET_CREATE_CONFLICT', 'Wallet create conflict');
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
        const perFingerprintCheck = await checkFingerprintAttemptDb(fingerprint);

        if (!perFingerprintCheck.allowed) {
            return sendError(
                res,
                429,
                'IMPORT_RATE_LIMITED',
                'Too many import attempts',
                { retryAfterSec: perFingerprintCheck.retryAfterSec },
            );
        }

        await recordFingerprintAttemptDb(fingerprint);

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

            await applyGlobalPinToUserWallets(
                tx,
                userId,
                newPinHash,
                newPinSalt,
                currentTime,
            );

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

        return res.json({
            success: true,
            data: {
                wallet: {
                    id: wallet.id,
                    address: formatWalletAddress(result.address),
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

router.post('/wallet/:id/pin/verify', strictLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const walletId = req.params.id;
        const userId = req.walletV2Auth?.userId || null;
        const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
        const ipHash = hashIpAddress(ipFromRequest(req)) || null;
        const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

        if (walletId !== req.walletV2Auth!.walletId) {
            return sendError(res, 403, 'FORBIDDEN', 'Wallet access denied');
        }

        if (!isValidPin(pin)) {
            return sendError(res, 400, 'INVALID_PIN', 'PIN format is invalid');
        }

        const [wallet, globalPinRecord] = await Promise.all([
            prisma.walletV2.findUnique({
                where: { id: walletId },
                select: {
                    id: true,
                    status: true,
                },
            }),
            getLatestGlobalPinRecord(prisma, {
                userId,
                walletId,
            }),
        ]);

        if (!wallet) {
            return sendError(res, 404, 'WALLET_NOT_FOUND', 'Wallet not found');
        }

        if (wallet.status !== 'active') {
            return sendError(res, 423, 'WALLET_BLOCKED', 'Wallet is blocked');
        }

        if (!globalPinRecord) {
            return sendError(res, 404, 'WALLET_NOT_FOUND', 'Wallet not found');
        }

        const lockoutWindowStart = new Date(Date.now() - PIN_VERIFY_LOCKOUT_WINDOW_MS);
        const failureCountResult = await prisma.$queryRaw<[{ count: bigint }]>(
            Prisma.sql`
                SELECT COUNT(*) AS count
                FROM audit_events_v2
                WHERE event = 'wallet.pin.verify.failed'
                  AND wallet_id = ${walletId}
                  AND created_at >= ${lockoutWindowStart}
            `,
        );
        const recentFailures = Number(failureCountResult[0]?.count ?? 0n);

        if (recentFailures >= PIN_VERIFY_MAX_FAILURES) {
            return sendError(res, 429, 'PIN_LOCKED', 'Too many failed PIN attempts. Try again later.');
        }

        const pinValid = await verifySecret(globalPinRecord.pinHash, pin, globalPinRecord.pinSalt);

        if (!pinValid) {
            await createAuditEvent({
                walletId,
                userId,
                event: 'wallet.pin.verify.failed',
                ipHash,
                userAgent,
            });
            return sendError(res, 401, 'INVALID_PIN', 'PIN is invalid');
        }

        return res.json({
            success: true,
            data: {
                valid: true,
            },
        });
    } catch (error) {
        console.error('Wallet v2 pin verify error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to verify PIN');
    }
});

router.post('/wallet/:id/pin/change', strictLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const walletId = req.params.id;
        const authUserId = req.walletV2Auth?.userId || null;
        const currentPin = typeof req.body?.currentPin === 'string' ? req.body.currentPin.trim() : '';
        const newPin = typeof req.body?.newPin === 'string' ? req.body.newPin.trim() : '';

        if (walletId !== req.walletV2Auth!.walletId) {
            return sendError(res, 403, 'FORBIDDEN', 'Wallet access denied');
        }

        if (!isValidPin(currentPin)) {
            return sendError(res, 400, 'CURRENT_PIN_REQUIRED', 'Current PIN is required');
        }

        if (!isValidPin(newPin)) {
            return sendError(res, 400, 'INVALID_PIN', 'New PIN format is invalid');
        }

        const wallet = await prisma.walletV2.findUnique({
            where: { id: walletId },
            select: {
                id: true,
                status: true,
                userId: true,
            },
        });

        if (!wallet) {
            return sendError(res, 404, 'WALLET_NOT_FOUND', 'Wallet not found');
        }

        if (wallet.status !== 'active') {
            return sendError(res, 423, 'WALLET_BLOCKED', 'Wallet is blocked');
        }

        const pinOwnerUserId = authUserId || wallet.userId;

        if (!pinOwnerUserId) {
            return sendError(res, 401, 'UNAUTHORIZED', 'Authorization token is required');
        }

        const globalPinRecord = await getLatestGlobalPinRecord(prisma, {
            userId: pinOwnerUserId,
            walletId,
        });

        if (!globalPinRecord) {
            return sendError(res, 404, 'WALLET_NOT_FOUND', 'Wallet not found');
        }

        const currentPinValid = await verifySecret(globalPinRecord.pinHash, currentPin, globalPinRecord.pinSalt);
        if (!currentPinValid) {
            return sendError(res, 401, 'INVALID_CURRENT_PIN', 'Current PIN is incorrect');
        }

        const currentTime = now();
        const pinSalt = generateSalt();
        const pinHash = await hashSecret(newPin, pinSalt);
        const ipHash = hashIpAddress(ipFromRequest(req)) || null;
        const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

        await prisma.$transaction(async (tx) => {
            await applyGlobalPinToUserWallets(
                tx,
                pinOwnerUserId,
                pinHash,
                pinSalt,
                currentTime,
            );
        });

        await createAuditEvent({
            walletId,
            userId: pinOwnerUserId,
            event: 'wallet.pin.changed',
            ipHash,
            userAgent,
            meta: {
                sessionId: req.walletV2Auth?.sessionId,
                deviceId: req.walletV2Auth?.deviceId,
            },
        });

        return res.json({
            success: true,
            data: {
                walletId,
                pinUpdatedAt: currentTime.toISOString(),
            },
        });
    } catch (error) {
        console.error('Wallet v2 pin change error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to change PIN');
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

router.get('/wallet/:id/nft-staking/state', standardLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const walletId = req.params.id;

        if (walletId !== req.walletV2Auth!.walletId) {
            return sendError(res, 403, 'FORBIDDEN', 'Wallet access denied');
        }

        assertNftStakingPrismaClientReady();

        const currentTime = now();

        const state = await prisma.$transaction(async (tx) => {
            const walletContext = await resolveWalletNftStakingContext(tx, walletId);
            const ownership: WalletNftOwnershipContext = {
                userId: walletContext.userId || req.walletV2Auth?.userId || null,
                mainAddress: walletContext.mainAddress,
            };

            const activePositions = await tx.nftStakingV2.findMany({
                where: {
                    walletId,
                    status: 'active',
                },
                orderBy: [
                    { stakedAt: 'desc' },
                    { tokenId: 'asc' },
                ],
                select: {
                    id: true,
                    tokenId: true,
                    status: true,
                    rewardPerHour: true,
                    stakedAt: true,
                    lastClaimAt: true,
                    totalClaimed: true,
                    nft: {
                        select: {
                            tokenId: true,
                            ownerWallet: true,
                            ownerId: true,
                            modelName: true,
                            serialNumber: true,
                            rarity: true,
                            tgsFile: true,
                            metadata: true,
                        },
                    },
                },
            });

            const globallyActiveStakeTokens = await tx.nftStakingV2.findMany({
                where: {
                    status: 'active',
                },
                select: {
                    tokenId: true,
                },
            });
            const stakedTokenIds = globallyActiveStakeTokens.map((position) => position.tokenId);
            const availableWhere: Prisma.NftWhereInput[] = [
                buildNftOwnershipWhere(ownership),
                {
                    NOT: {
                        status: {
                            equals: 'burned',
                            mode: 'insensitive',
                        },
                    },
                },
            ];

            if (stakedTokenIds.length > 0) {
                availableWhere.push({
                    tokenId: {
                        notIn: stakedTokenIds,
                    },
                });
            }

            const availableNfts = await tx.nft.findMany({
                where: { AND: availableWhere },
                orderBy: [
                    { lastTransferAt: 'desc' },
                    { mintedAt: 'desc' },
                ],
                take: 200,
                select: {
                    tokenId: true,
                    modelName: true,
                    serialNumber: true,
                    rarity: true,
                    tgsFile: true,
                    metadata: true,
                    lastTransferAt: true,
                    mintedAt: true,
                },
            });

            let pendingRewardTotal = 0n;
            let totalClaimed = 0n;
            const positionRows = activePositions.map((position) => {
                const nft = position.nft;
                const rewardPerHour = position.rewardPerHour > 0n
                    ? position.rewardPerHour
                    : resolveNftStakingRewardPerHour(nft?.rarity);
                const pending = computeNftStakingPendingReward({
                    lastClaimAt: position.lastClaimAt,
                    rewardPerHour,
                    currentTime,
                });
                const canUnstakeAt = addHours(position.stakedAt, NFT_STAKING_UNSTAKE_COOLDOWN_HOURS);
                const canUnstake = currentTime.getTime() >= canUnstakeAt.getTime();
                const owned = nft
                    ? isNftOwnedByWallet({
                        nftOwnerId: nft.ownerId,
                        nftOwnerWallet: nft.ownerWallet,
                        ownership,
                    })
                    : false;

                pendingRewardTotal += pending.amount;
                totalClaimed += position.totalClaimed;

                return {
                    tokenId: position.tokenId,
                    status: position.status,
                    owned,
                    modelName: nft?.modelName || null,
                    serialNumber: nft?.serialNumber || null,
                    rarity: nft?.rarity || null,
                    collectionName: readCollectionName(nft?.metadata),
                    tgsUrl: nft?.tgsFile ? `/models/${nft.tgsFile}` : null,
                    stakedAt: position.stakedAt.toISOString(),
                    lastClaimAt: position.lastClaimAt.toISOString(),
                    rewardPerHour: rewardPerHour.toString(),
                    pendingReward: pending.amount.toString(),
                    totalClaimed: position.totalClaimed.toString(),
                    canClaim: pending.amount > 0n,
                    canUnstake,
                    unstakeAvailableAt: canUnstakeAt.toISOString(),
                };
            });

            const availableRows = availableNfts.map((nft) => {
                const anchorAt = nft.lastTransferAt || nft.mintedAt;
                const stakeWindow = buildStakeWindow(anchorAt, currentTime);

                return {
                    tokenId: nft.tokenId,
                    modelName: nft.modelName,
                    serialNumber: nft.serialNumber,
                    rarity: nft.rarity,
                    collectionName: readCollectionName(nft.metadata),
                    tgsUrl: nft.tgsFile ? `/models/${nft.tgsFile}` : null,
                    lastTransferAt: toIsoDate(nft.lastTransferAt),
                    mintedAt: nft.mintedAt.toISOString(),
                    stakeWindow: {
                        opensAt: stakeWindow.opensAt.toISOString(),
                        closesAt: stakeWindow.closesAt.toISOString(),
                        canStake: stakeWindow.canStake,
                        reason: stakeWindow.reason,
                    },
                };
            });

            return {
                address: walletContext.mainAddress,
                summary: {
                    activeCount: positionRows.length,
                    availableCount: availableRows.length,
                    pendingRewardTotal,
                    totalClaimed,
                },
                positions: positionRows,
                available: availableRows,
            };
        });

        return res.json({
            success: true,
            data: {
                walletId,
                address: formatWalletAddress(state.address),
                rewardAsset: NFT_STAKING_REWARD_ASSET,
                rules: {
                    windowStartHours: NFT_STAKING_WINDOW_START_HOURS,
                    windowEndHours: NFT_STAKING_WINDOW_END_HOURS,
                    unstakeCooldownHours: NFT_STAKING_UNSTAKE_COOLDOWN_HOURS,
                },
                summary: {
                    activeCount: state.summary.activeCount,
                    availableCount: state.summary.availableCount,
                    pendingReward: state.summary.pendingRewardTotal.toString(),
                    totalClaimed: state.summary.totalClaimed.toString(),
                },
                positions: state.positions,
                available: state.available,
                timestamp: currentTime.toISOString(),
            },
        });
    } catch (error) {
        if (error instanceof ApiError) {
            return sendError(res, error.statusCode, error.code, error.message, error.details);
        }

        const schemaErrorResponse = handleNftStakingSchemaNotReadyError({
            res,
            error,
            context: 'Wallet v2 nft staking state',
        });

        if (schemaErrorResponse) {
            return schemaErrorResponse;
        }

        console.error('Wallet v2 nft staking state error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch NFT staking state');
    }
});

router.post('/wallet/:id/nft-staking/stake', strictLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const walletId = req.params.id;
        const tokenId = typeof req.body?.tokenId === 'string' ? req.body.tokenId.trim() : '';

        if (walletId !== req.walletV2Auth!.walletId) {
            return sendError(res, 403, 'FORBIDDEN', 'Wallet access denied');
        }

        if (!tokenId) {
            return sendError(res, 400, 'TOKEN_ID_REQUIRED', 'tokenId is required');
        }

        assertNftStakingPrismaClientReady();

        const currentTime = now();
        const ipHash = hashIpAddress(ipFromRequest(req)) || null;
        const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

        const stakeResult = await prisma.$transaction(async (tx) => {
            const walletContext = await resolveWalletNftStakingContext(tx, walletId);
            const ownership: WalletNftOwnershipContext = {
                userId: walletContext.userId || req.walletV2Auth?.userId || null,
                mainAddress: walletContext.mainAddress,
            };
            const nft = await tx.nft.findUnique({
                where: { tokenId },
                select: {
                    tokenId: true,
                    ownerWallet: true,
                    ownerId: true,
                    modelName: true,
                    serialNumber: true,
                    rarity: true,
                    tgsFile: true,
                    metadata: true,
                    status: true,
                    lastTransferAt: true,
                    mintedAt: true,
                },
            });

            if (!nft) {
                throw new ApiError(404, 'NFT_NOT_FOUND', 'NFT not found');
            }

            if ((nft.status || '').trim().toLowerCase() === 'burned') {
                throw new ApiError(409, 'NFT_UNAVAILABLE', 'NFT is not available for staking');
            }

            if (!isNftOwnedByWallet({
                nftOwnerId: nft.ownerId,
                nftOwnerWallet: nft.ownerWallet,
                ownership,
            })) {
                throw new ApiError(403, 'NFT_NOT_OWNED', 'NFT does not belong to the authenticated wallet');
            }

            const existingPosition = await tx.nftStakingV2.findUnique({
                where: { tokenId },
                select: {
                    id: true,
                    walletId: true,
                    status: true,
                },
            });

            if (existingPosition?.status === 'active') {
                throw new ApiError(409, 'NFT_ALREADY_STAKED', 'NFT is already staked');
            }

            const window = buildStakeWindow(nft.lastTransferAt || nft.mintedAt, currentTime);

            if (window.reason === 'not_open') {
                throw new ApiError(
                    409,
                    'STAKE_WINDOW_NOT_OPEN',
                    'Staking window has not opened yet',
                    {
                        opensAt: window.opensAt.toISOString(),
                        closesAt: window.closesAt.toISOString(),
                    },
                );
            }

            if (window.reason === 'closed') {
                throw new ApiError(
                    409,
                    'STAKE_WINDOW_CLOSED',
                    'Staking window is closed',
                    {
                        opensAt: window.opensAt.toISOString(),
                        closesAt: window.closesAt.toISOString(),
                    },
                );
            }

            const rewardPerHour = resolveNftStakingRewardPerHour(nft.rarity);
            const stakeRecord = existingPosition
                ? await tx.nftStakingV2.update({
                    where: { id: existingPosition.id },
                    data: {
                        walletId,
                        userId: ownership.userId,
                        status: 'active',
                        rewardPerHour,
                        stakedAt: currentTime,
                        lastClaimAt: currentTime,
                        unstakedAt: null,
                        updatedAt: currentTime,
                    },
                    select: {
                        tokenId: true,
                        stakedAt: true,
                        lastClaimAt: true,
                        totalClaimed: true,
                        rewardPerHour: true,
                    },
                })
                : await tx.nftStakingV2.create({
                    data: {
                        id: crypto.randomUUID(),
                        walletId,
                        tokenId,
                        userId: ownership.userId,
                        status: 'active',
                        rewardPerHour,
                        stakedAt: currentTime,
                        lastClaimAt: currentTime,
                        totalClaimed: 0n,
                        createdAt: currentTime,
                        updatedAt: currentTime,
                    },
                    select: {
                        tokenId: true,
                        stakedAt: true,
                        lastClaimAt: true,
                        totalClaimed: true,
                        rewardPerHour: true,
                    },
                });

            await createAuditEvent({
                tx,
                walletId,
                userId: ownership.userId,
                event: 'nft.staking.staked',
                ipHash,
                userAgent,
                meta: {
                    tokenId,
                    rewardPerHour: rewardPerHour.toString(),
                },
            });

            return {
                walletAddress: walletContext.mainAddress,
                nft,
                stakeRecord,
                window,
            };
        });

        return res.status(201).json({
            success: true,
            data: {
                walletId,
                address: formatWalletAddress(stakeResult.walletAddress),
                rewardAsset: NFT_STAKING_REWARD_ASSET,
                position: {
                    tokenId: stakeResult.stakeRecord.tokenId,
                    modelName: stakeResult.nft.modelName,
                    serialNumber: stakeResult.nft.serialNumber,
                    rarity: stakeResult.nft.rarity,
                    collectionName: readCollectionName(stakeResult.nft.metadata),
                    tgsUrl: stakeResult.nft.tgsFile ? `/models/${stakeResult.nft.tgsFile}` : null,
                    stakedAt: stakeResult.stakeRecord.stakedAt.toISOString(),
                    lastClaimAt: stakeResult.stakeRecord.lastClaimAt.toISOString(),
                    rewardPerHour: stakeResult.stakeRecord.rewardPerHour.toString(),
                    totalClaimed: stakeResult.stakeRecord.totalClaimed.toString(),
                    stakeWindow: {
                        opensAt: stakeResult.window.opensAt.toISOString(),
                        closesAt: stakeResult.window.closesAt.toISOString(),
                    },
                },
            },
        });
    } catch (error) {
        if (error instanceof ApiError) {
            return sendError(res, error.statusCode, error.code, error.message, error.details);
        }

        const schemaErrorResponse = handleNftStakingSchemaNotReadyError({
            res,
            error,
            context: 'Wallet v2 nft staking stake',
        });

        if (schemaErrorResponse) {
            return schemaErrorResponse;
        }

        console.error('Wallet v2 nft staking stake error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to stake NFT');
    }
});

router.post('/wallet/:id/nft-staking/claim', strictLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const walletId = req.params.id;
        const tokenId = typeof req.body?.tokenId === 'string' ? req.body.tokenId.trim() : '';

        if (walletId !== req.walletV2Auth!.walletId) {
            return sendError(res, 403, 'FORBIDDEN', 'Wallet access denied');
        }

        if (!tokenId) {
            return sendError(res, 400, 'TOKEN_ID_REQUIRED', 'tokenId is required');
        }

        assertNftStakingPrismaClientReady();

        const currentTime = now();
        const ipHash = hashIpAddress(ipFromRequest(req)) || null;
        const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

        const claimResult = await prisma.$transaction(async (tx) => {
            const walletContext = await resolveWalletNftStakingContext(tx, walletId);
            const ownership: WalletNftOwnershipContext = {
                userId: walletContext.userId || req.walletV2Auth?.userId || null,
                mainAddress: walletContext.mainAddress,
            };
            const position = await tx.nftStakingV2.findFirst({
                where: {
                    walletId,
                    tokenId,
                    status: 'active',
                },
                select: {
                    id: true,
                    tokenId: true,
                    rewardPerHour: true,
                    stakedAt: true,
                    lastClaimAt: true,
                    totalClaimed: true,
                    nft: {
                        select: {
                            tokenId: true,
                            ownerWallet: true,
                            ownerId: true,
                            modelName: true,
                            serialNumber: true,
                            rarity: true,
                            tgsFile: true,
                            metadata: true,
                        },
                    },
                },
            });

            if (!position || !position.nft) {
                throw new ApiError(404, 'STAKE_POSITION_NOT_FOUND', 'Staking position not found');
            }

            if (!isNftOwnedByWallet({
                nftOwnerId: position.nft.ownerId,
                nftOwnerWallet: position.nft.ownerWallet,
                ownership,
            })) {
                throw new ApiError(403, 'NFT_NOT_OWNED', 'NFT does not belong to the authenticated wallet');
            }

            const rewardPerHour = position.rewardPerHour > 0n
                ? position.rewardPerHour
                : resolveNftStakingRewardPerHour(position.nft.rarity);
            const pending = computeNftStakingPendingReward({
                lastClaimAt: position.lastClaimAt,
                rewardPerHour,
                currentTime,
            });

            if (pending.amount <= 0n) {
                throw new ApiError(
                    409,
                    'NO_REWARD_AVAILABLE',
                    'No reward available yet',
                    {
                        nextClaimAt: pending.nextClaimAt.toISOString(),
                        elapsedWholeHours: pending.elapsedWholeHours,
                    },
                );
            }

            const rewardCredit = await creditNftStakingReward(tx, {
                walletId,
                tokenId,
                amount: pending.amount,
                mainAddress: walletContext.mainAddress,
                currentTime,
            });

            if (!rewardCredit) {
                throw new ApiError(409, 'NO_REWARD_AVAILABLE', 'No reward available yet');
            }

            const updatedPosition = await tx.nftStakingV2.update({
                where: { id: position.id },
                data: {
                    rewardPerHour,
                    lastClaimAt: currentTime,
                    totalClaimed: { increment: pending.amount },
                    updatedAt: currentTime,
                },
                select: {
                    tokenId: true,
                    stakedAt: true,
                    lastClaimAt: true,
                    totalClaimed: true,
                    rewardPerHour: true,
                },
            });

            await createAuditEvent({
                tx,
                walletId,
                userId: ownership.userId,
                event: 'nft.staking.claimed',
                ipHash,
                userAgent,
                meta: {
                    tokenId,
                    claimedAmount: pending.amount.toString(),
                    txId: rewardCredit.rewardTx.id,
                },
            });

            return {
                walletAddress: walletContext.mainAddress,
                nft: position.nft,
                claimedAmount: pending.amount,
                updatedPosition,
                balance: rewardCredit.creditedBalance,
                rewardTx: rewardCredit.rewardTx,
            };
        });

        return res.json({
            success: true,
            data: {
                walletId,
                address: formatWalletAddress(claimResult.walletAddress),
                tokenId,
                rewardAsset: NFT_STAKING_REWARD_ASSET,
                claimedAmount: claimResult.claimedAmount.toString(),
                position: {
                    tokenId: claimResult.updatedPosition.tokenId,
                    modelName: claimResult.nft.modelName,
                    serialNumber: claimResult.nft.serialNumber,
                    rarity: claimResult.nft.rarity,
                    collectionName: readCollectionName(claimResult.nft.metadata),
                    tgsUrl: claimResult.nft.tgsFile ? `/models/${claimResult.nft.tgsFile}` : null,
                    stakedAt: claimResult.updatedPosition.stakedAt.toISOString(),
                    lastClaimAt: claimResult.updatedPosition.lastClaimAt.toISOString(),
                    rewardPerHour: claimResult.updatedPosition.rewardPerHour.toString(),
                    totalClaimed: claimResult.updatedPosition.totalClaimed.toString(),
                },
                balance: {
                    asset: claimResult.balance.asset,
                    available: claimResult.balance.available.toString(),
                    locked: claimResult.balance.locked.toString(),
                    updatedAt: claimResult.balance.updatedAt.toISOString(),
                },
                tx: {
                    id: claimResult.rewardTx.id,
                    status: claimResult.rewardTx.status,
                    fromAddress: formatWalletAddress(claimResult.rewardTx.fromAddress),
                    toAddress: formatWalletAddress(claimResult.rewardTx.toAddress),
                    asset: claimResult.rewardTx.asset,
                    amount: claimResult.rewardTx.amount.toString(),
                    createdAt: claimResult.rewardTx.createdAt.toISOString(),
                    completedAt: toIsoDate(claimResult.rewardTx.completedAt),
                },
            },
        });
    } catch (error) {
        if (error instanceof ApiError) {
            return sendError(res, error.statusCode, error.code, error.message, error.details);
        }

        const schemaErrorResponse = handleNftStakingSchemaNotReadyError({
            res,
            error,
            context: 'Wallet v2 nft staking claim',
        });

        if (schemaErrorResponse) {
            return schemaErrorResponse;
        }

        console.error('Wallet v2 nft staking claim error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to claim staking reward');
    }
});

router.post('/wallet/:id/nft-staking/unstake', strictLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const walletId = req.params.id;
        const tokenId = typeof req.body?.tokenId === 'string' ? req.body.tokenId.trim() : '';
        const claimRewards = req.body?.claimRewards !== false;

        if (walletId !== req.walletV2Auth!.walletId) {
            return sendError(res, 403, 'FORBIDDEN', 'Wallet access denied');
        }

        if (!tokenId) {
            return sendError(res, 400, 'TOKEN_ID_REQUIRED', 'tokenId is required');
        }

        assertNftStakingPrismaClientReady();

        const currentTime = now();
        const ipHash = hashIpAddress(ipFromRequest(req)) || null;
        const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

        const unstakeResult = await prisma.$transaction(async (tx) => {
            const walletContext = await resolveWalletNftStakingContext(tx, walletId);
            const ownership: WalletNftOwnershipContext = {
                userId: walletContext.userId || req.walletV2Auth?.userId || null,
                mainAddress: walletContext.mainAddress,
            };

            const position = await tx.nftStakingV2.findFirst({
                where: {
                    walletId,
                    tokenId,
                    status: 'active',
                },
                select: {
                    id: true,
                    tokenId: true,
                    rewardPerHour: true,
                    stakedAt: true,
                    lastClaimAt: true,
                    totalClaimed: true,
                    nft: {
                        select: {
                            tokenId: true,
                            ownerWallet: true,
                            ownerId: true,
                            modelName: true,
                            serialNumber: true,
                            rarity: true,
                            tgsFile: true,
                            metadata: true,
                        },
                    },
                },
            });

            if (!position) {
                throw new ApiError(404, 'STAKE_POSITION_NOT_FOUND', 'Staking position not found');
            }

            const unstakeAvailableAt = addHours(position.stakedAt, NFT_STAKING_UNSTAKE_COOLDOWN_HOURS);

            if (currentTime.getTime() < unstakeAvailableAt.getTime()) {
                throw new ApiError(
                    409,
                    'UNSTAKE_COOLDOWN_ACTIVE',
                    'NFT cannot be unstaked yet',
                    {
                        unstakeAvailableAt: unstakeAvailableAt.toISOString(),
                    },
                );
            }

            const rewardPerHour = position.rewardPerHour > 0n
                ? position.rewardPerHour
                : resolveNftStakingRewardPerHour(position.nft?.rarity);
            let claimedAmount = 0n;
            let claimedBalance: {
                asset: string;
                available: bigint;
                locked: bigint;
                updatedAt: Date;
            } | null = null;
            let rewardTx: {
                id: string;
                status: string;
                fromAddress: string;
                toAddress: string;
                asset: string;
                amount: bigint;
                createdAt: Date;
                completedAt: Date | null;
            } | null = null;
            const ownedByCurrentWallet = Boolean(
                position.nft
                && isNftOwnedByWallet({
                    nftOwnerId: position.nft.ownerId,
                    nftOwnerWallet: position.nft.ownerWallet,
                    ownership,
                }),
            );

            if (claimRewards && ownedByCurrentWallet) {
                const pending = computeNftStakingPendingReward({
                    lastClaimAt: position.lastClaimAt,
                    rewardPerHour,
                    currentTime,
                });

                if (pending.amount > 0n) {
                    const rewardCredit = await creditNftStakingReward(tx, {
                        walletId,
                        tokenId,
                        amount: pending.amount,
                        mainAddress: walletContext.mainAddress,
                        currentTime,
                    });

                    if (rewardCredit) {
                        claimedAmount = pending.amount;
                        claimedBalance = rewardCredit.creditedBalance;
                        rewardTx = rewardCredit.rewardTx;
                    }
                }
            }

            const updatedPosition = await tx.nftStakingV2.update({
                where: { id: position.id },
                data: {
                    status: 'unstaked',
                    rewardPerHour,
                    lastClaimAt: currentTime,
                    unstakedAt: currentTime,
                    updatedAt: currentTime,
                    ...(claimedAmount > 0n
                        ? {
                            totalClaimed: { increment: claimedAmount },
                        }
                        : {}),
                },
                select: {
                    tokenId: true,
                    status: true,
                    stakedAt: true,
                    lastClaimAt: true,
                    totalClaimed: true,
                    rewardPerHour: true,
                    unstakedAt: true,
                },
            });

            await createAuditEvent({
                tx,
                walletId,
                userId: ownership.userId,
                event: 'nft.staking.unstaked',
                ipHash,
                userAgent,
                meta: {
                    tokenId,
                    claimRewards,
                    claimedAmount: claimedAmount.toString(),
                    rewardTxId: rewardTx?.id || null,
                },
            });

            return {
                walletAddress: walletContext.mainAddress,
                nft: position.nft,
                updatedPosition,
                claimedAmount,
                claimedBalance,
                rewardTx,
                ownedByCurrentWallet,
            };
        });

        return res.json({
            success: true,
            data: {
                walletId,
                address: formatWalletAddress(unstakeResult.walletAddress),
                tokenId,
                rewardAsset: NFT_STAKING_REWARD_ASSET,
                claimRewardsApplied: claimRewards && unstakeResult.ownedByCurrentWallet,
                claimedAmount: unstakeResult.claimedAmount.toString(),
                position: {
                    tokenId: unstakeResult.updatedPosition.tokenId,
                    status: unstakeResult.updatedPosition.status,
                    modelName: unstakeResult.nft?.modelName || null,
                    serialNumber: unstakeResult.nft?.serialNumber || null,
                    rarity: unstakeResult.nft?.rarity || null,
                    collectionName: readCollectionName(unstakeResult.nft?.metadata),
                    tgsUrl: unstakeResult.nft?.tgsFile ? `/models/${unstakeResult.nft.tgsFile}` : null,
                    stakedAt: unstakeResult.updatedPosition.stakedAt.toISOString(),
                    lastClaimAt: unstakeResult.updatedPosition.lastClaimAt.toISOString(),
                    rewardPerHour: unstakeResult.updatedPosition.rewardPerHour.toString(),
                    totalClaimed: unstakeResult.updatedPosition.totalClaimed.toString(),
                    unstakedAt: toIsoDate(unstakeResult.updatedPosition.unstakedAt),
                },
                ...(unstakeResult.claimedBalance && unstakeResult.rewardTx
                    ? {
                        balance: {
                            asset: unstakeResult.claimedBalance.asset,
                            available: unstakeResult.claimedBalance.available.toString(),
                            locked: unstakeResult.claimedBalance.locked.toString(),
                            updatedAt: unstakeResult.claimedBalance.updatedAt.toISOString(),
                        },
                        tx: {
                            id: unstakeResult.rewardTx.id,
                            status: unstakeResult.rewardTx.status,
                            fromAddress: formatWalletAddress(unstakeResult.rewardTx.fromAddress),
                            toAddress: formatWalletAddress(unstakeResult.rewardTx.toAddress),
                            asset: unstakeResult.rewardTx.asset,
                            amount: unstakeResult.rewardTx.amount.toString(),
                            createdAt: unstakeResult.rewardTx.createdAt.toISOString(),
                            completedAt: toIsoDate(unstakeResult.rewardTx.completedAt),
                        },
                    }
                    : {}),
            },
        });
    } catch (error) {
        if (error instanceof ApiError) {
            return sendError(res, error.statusCode, error.code, error.message, error.details);
        }

        const schemaErrorResponse = handleNftStakingSchemaNotReadyError({
            res,
            error,
            context: 'Wallet v2 nft staking unstake',
        });

        if (schemaErrorResponse) {
            return schemaErrorResponse;
        }

        console.error('Wallet v2 nft staking unstake error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to unstake NFT');
    }
});


// ─── NFT Story Share ──────────────────────────────────────────────────────────
// Пользователь нажал "Share Story" в TG → фронт вызвал shareToStory() →
// затем сразу POST сюда чтобы зафиксировать факт шаринга и начислить бонус.
//
// Логика streak:
//   - Если последний share был вчера (в пределах 24-48ч) → streak++
//   - Если сегодня уже шарил (< 24ч) → 429 STORY_ALREADY_SHARED_TODAY
//   - Если пропустил день (> 48ч) → streak сбрасывается в 1
//
// Бонус = rewardPerHour * streakDay (capped at 7x)
// ─────────────────────────────────────────────────────────────────────────────

const NFT_STORY_SHARE_COOLDOWN_HOURS = 20;   // минимум между шарами (не чаще раз в 20ч)
const NFT_STORY_SHARE_STREAK_WINDOW_HOURS = 48; // максимум для продолжения streak
const NFT_STORY_SHARE_MAX_STREAK_MULTIPLIER = 7; // максимальный множитель

function assertNftStorySharePrismaClientReady(): void {
    const delegate = (prisma as unknown as { nftStoryShare?: unknown }).nftStoryShare;
    if (delegate !== undefined) return;
    throw new ApiError(
        503,
        'NFT_STORY_SHARE_SCHEMA_NOT_READY',
        'NFT story share database schema is not initialized',
    );
}

router.post('/wallet/:id/nft-staking/story-share', strictLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const walletId = req.params.id;

        if (walletId !== req.walletV2Auth!.walletId) {
            return sendError(res, 403, 'FORBIDDEN', 'Wallet access denied');
        }

        assertNftStakingPrismaClientReady();
        assertNftStorySharePrismaClientReady();

        const tokenId = typeof req.body?.tokenId === 'string' ? req.body.tokenId.trim() : '';
        if (!tokenId) {
            return sendError(res, 400, 'TOKEN_ID_REQUIRED', 'tokenId is required');
        }

        const currentTime = now();

        const result = await prisma.$transaction(async (tx) => {
            // 1. Проверяем что кошелёк существует и активен
            const walletContext = await resolveWalletNftStakingContext(tx, walletId);
            const userId = walletContext.userId || req.walletV2Auth?.userId || null;

            // 2. Проверяем что NFT застейкан этим кошельком
            const position = await tx.nftStakingV2.findFirst({
                where: { walletId, tokenId, status: 'active' },
                select: {
                    id: true,
                    rewardPerHour: true,
                    nft: {
                        select: {
                            rarity: true,
                            ownerId: true,
                            ownerWallet: true,
                        },
                    },
                },
            });

            if (!position) {
                throw new ApiError(404, 'STAKE_POSITION_NOT_FOUND', 'Active staking position not found for this NFT');
            }

            // 2b. Проверяем что NFT всё ещё принадлежит этому кошельку
            if (position.nft) {
                const owned = isNftOwnedByWallet({
                    nftOwnerId: position.nft.ownerId,
                    nftOwnerWallet: position.nft.ownerWallet,
                    ownership: { userId: walletContext.userId || req.walletV2Auth?.userId || null, mainAddress: walletContext.mainAddress },
                });
                if (!owned) {
                    throw new ApiError(403, 'NFT_NOT_OWNED', 'NFT no longer belongs to this wallet');
                }
            }

            // 3. Проверяем cooldown — нельзя шарить чаще раз в 20 часов
            const lastShare = await (tx as unknown as { nftStoryShare: { findFirst: Function } }).nftStoryShare.findFirst({
                where: { walletId, tokenId },
                orderBy: { sharedAt: 'desc' },
                select: { id: true, sharedAt: true, streakDay: true },
            });

            const cooldownMs = NFT_STORY_SHARE_COOLDOWN_HOURS * 60 * 60 * 1000;
            const streakWindowMs = NFT_STORY_SHARE_STREAK_WINDOW_HOURS * 60 * 60 * 1000;

            if (lastShare) {
                const msSinceLast = currentTime.getTime() - lastShare.sharedAt.getTime();
                if (msSinceLast < cooldownMs) {
                    const nextShareAt = new Date(lastShare.sharedAt.getTime() + cooldownMs);
                    throw new ApiError(429, 'STORY_ALREADY_SHARED_TODAY', 'Already shared story for this NFT today', {
                        nextShareAt: nextShareAt.toISOString(),
                    });
                }
            }

            // 4. Вычисляем streak
            let streakDay = 1;
            if (lastShare) {
                const msSinceLast = currentTime.getTime() - lastShare.sharedAt.getTime();
                if (msSinceLast <= streakWindowMs) {
                    // Продолжаем streak
                    streakDay = Math.min(lastShare.streakDay + 1, 99);
                }
                // Иначе streak сбрасывается в 1
            }

            // 5. Вычисляем бонус
            const rewardPerHour = position.rewardPerHour > 0n
                ? position.rewardPerHour
                : resolveNftStakingRewardPerHour(position.nft?.rarity);

            const multiplier = BigInt(Math.min(streakDay, NFT_STORY_SHARE_MAX_STREAK_MULTIPLIER));
            const bonusAmount = rewardPerHour * multiplier;

            // 6. Записываем share
            const shareId = crypto.randomUUID();
            const shareRecord = await (tx as unknown as { nftStoryShare: { create: Function } }).nftStoryShare.create({
                data: {
                    id: shareId,
                    walletId,
                    tokenId,
                    userId,
                    sharedAt: currentTime,
                    bonusAmount,
                    streakDay,
                    createdAt: currentTime,
                },
            });

            // 7. Начисляем бонус на баланс (если > 0)
            let balanceRow = null;
            let txRecord = null;

            if (bonusAmount > 0n) {
                await tx.balanceV2.upsert({
                    where: { walletId_asset: { walletId, asset: NFT_STAKING_REWARD_ASSET } },
                    update: {
                        available: { increment: bonusAmount },
                        updatedAt: currentTime,
                    },
                    create: {
                        walletId,
                        asset: NFT_STAKING_REWARD_ASSET,
                        available: bonusAmount,
                        locked: 0n,
                        updatedAt: currentTime,
                    },
                });

                const txId = crypto.randomUUID();
                txRecord = await tx.txV2.create({
                    data: {
                        id: txId,
                        walletId,
                        fromAddress: WALLET_V2_STAKING_REWARD_SOURCE_ADDRESS,
                        toAddress: walletContext.mainAddress,
                        asset: NFT_STAKING_REWARD_ASSET,
                        amount: bonusAmount,
                        status: 'completed',
                        meta: {
                            source: 'nft_story_share_bonus',
                            tokenId,
                            streakDay,
                        },
                        createdAt: currentTime,
                        confirmedAt: currentTime,
                        completedAt: currentTime,
                    },
                    select: {
                        id: true,
                        status: true,
                        asset: true,
                        amount: true,
                        createdAt: true,
                        completedAt: true,
                    },
                });

                const updatedBalance = await tx.balanceV2.findUnique({
                    where: { walletId_asset: { walletId, asset: NFT_STAKING_REWARD_ASSET } },
                    select: { asset: true, available: true, locked: true, updatedAt: true },
                });

                if (updatedBalance) {
                    balanceRow = {
                        asset: updatedBalance.asset,
                        available: updatedBalance.available.toString(),
                        locked: updatedBalance.locked.toString(),
                        updatedAt: updatedBalance.updatedAt.toISOString(),
                    };
                }
            }

            return { shareRecord, bonusAmount, streakDay, balanceRow, txRecord };
        });

        return res.json({
            success: true,
            data: {
                walletId,
                tokenId,
                rewardAsset: NFT_STAKING_REWARD_ASSET,
                streakDay: result.streakDay,
                bonusAmount: result.bonusAmount.toString(),
                sharedAt: result.shareRecord.sharedAt.toISOString(),
                balance: result.balanceRow,
                tx: result.txRecord ? {
                    id: result.txRecord.id,
                    status: result.txRecord.status,
                    asset: result.txRecord.asset,
                    amount: result.txRecord.amount.toString(),
                    createdAt: result.txRecord.createdAt.toISOString(),
                    completedAt: result.txRecord.completedAt?.toISOString() || null,
                } : null,
            },
        });
    } catch (error) {
        if (error instanceof ApiError) {
            return sendError(res, error.statusCode, error.code, error.message, error.details);
        }

        const schemaErrorResponse = handleNftStakingSchemaNotReadyError({
            res,
            error,
            context: 'Wallet v2 nft story share',
        });

        if (schemaErrorResponse) return schemaErrorResponse;

        console.error('Wallet v2 nft story share error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to record story share');
    }
});

// ─── GET story-share state для конкретного NFT ────────────────────────────────
router.get('/wallet/:id/nft-staking/story-share/:tokenId', standardLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const walletId = req.params.id;
        const tokenId = req.params.tokenId?.trim() || '';

        if (walletId !== req.walletV2Auth!.walletId) {
            return sendError(res, 403, 'FORBIDDEN', 'Wallet access denied');
        }

        if (!tokenId) {
            return sendError(res, 400, 'TOKEN_ID_REQUIRED', 'tokenId is required');
        }

        assertNftStakingPrismaClientReady();
        assertNftStorySharePrismaClientReady();

        const currentTime = now();
        const cooldownMs = NFT_STORY_SHARE_COOLDOWN_HOURS * 60 * 60 * 1000;
        const streakWindowMs = NFT_STORY_SHARE_STREAK_WINDOW_HOURS * 60 * 60 * 1000;

        const lastShare = await (prisma as unknown as { nftStoryShare: { findFirst: Function } }).nftStoryShare.findFirst({
            where: { walletId, tokenId },
            orderBy: { sharedAt: 'desc' },
            select: { id: true, sharedAt: true, streakDay: true, bonusAmount: true },
        });

        const totalShares = await (prisma as unknown as { nftStoryShare: { count: Function } }).nftStoryShare.count({
            where: { walletId, tokenId },
        });

        let canShare = true;
        let nextShareAt: string | null = null;
        let currentStreak = 1;
        let streakActive = false;

        if (lastShare) {
            const msSinceLast = currentTime.getTime() - lastShare.sharedAt.getTime();
            if (msSinceLast < cooldownMs) {
                canShare = false;
                nextShareAt = new Date(lastShare.sharedAt.getTime() + cooldownMs).toISOString();
            }
            streakActive = msSinceLast <= streakWindowMs;
            currentStreak = streakActive ? lastShare.streakDay : 1;
        }

        const nextStreakDay = streakActive ? Math.min(currentStreak + 1, 99) : 1;
        const nextMultiplier = Math.min(nextStreakDay, NFT_STORY_SHARE_MAX_STREAK_MULTIPLIER);

        // Проверяем есть ли активная позиция стейкинга
        const activePosition = await (prisma as unknown as { nftStakingV2: { findFirst: Function } }).nftStakingV2.findFirst({
            where: { walletId, tokenId, status: 'active' },
            select: { id: true },
        });

        const nextBonusAmount = activePosition
            ? (() => {
                // Для отображения следующего бонуса нужен rewardPerHour
                return null; // будет вычислен на фронте из position.rewardPerHour * nextMultiplier
            })()
            : null;

        return res.json({
            success: true,
            data: {
                walletId,
                tokenId,
                isStaked: Boolean(activePosition),
                canShare: Boolean(activePosition) && canShare,
                nextShareAt,
                currentStreak,
                streakActive,
                nextMultiplier,
                totalShares,
                lastSharedAt: lastShare ? lastShare.sharedAt.toISOString() : null,
                cooldownHours: NFT_STORY_SHARE_COOLDOWN_HOURS,
                streakWindowHours: NFT_STORY_SHARE_STREAK_WINDOW_HOURS,
                maxStreakMultiplier: NFT_STORY_SHARE_MAX_STREAK_MULTIPLIER,
            },
        });
    } catch (error) {
        if (error instanceof ApiError) {
            return sendError(res, error.statusCode, error.code, error.message, error.details);
        }

        console.error('Wallet v2 nft story share state error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch story share state');
    }
});

router.post('/wallet/:id/topup-testnet', strictLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const walletId = req.params.id;
        const asset = typeof req.body?.asset === 'string'
            ? req.body.asset.trim().toUpperCase()
            : DEFAULT_ASSET;
        const amount = parseAmountToBigInt(req.body?.amount);

        if (walletId !== req.walletV2Auth!.walletId) {
            return sendError(res, 403, 'FORBIDDEN', 'Wallet access denied');
        }

        if (WALLET_V2_NETWORK !== 'testnet') {
            return sendError(res, 403, 'TESTNET_ONLY', 'Test top up is available only in testnet mode');
        }

        if (!asset || !VALID_ASSET_REGEX.test(asset)) {
            return sendError(res, 400, 'INVALID_ASSET', 'Asset is invalid');
        }

        if (!amount) {
            return sendError(res, 400, 'INVALID_AMOUNT', 'Amount must be a positive integer string');
        }

        if (amount > WALLET_V2_TESTNET_TOPUP_MAX_AMOUNT) {
            return sendError(res, 400, 'INVALID_AMOUNT', 'Amount exceeds testnet faucet limit');
        }

        const currentTime = now();
        const ipHash = hashIpAddress(ipFromRequest(req)) || null;
        const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

        const result = await prisma.$transaction(async (tx) => {
            const wallet = await tx.walletV2.findUnique({
                where: { id: walletId },
                select: {
                    id: true,
                    status: true,
                },
            });

            if (!wallet) {
                throw new ApiError(404, 'WALLET_NOT_FOUND', 'Wallet not found');
            }

            if (wallet.status !== 'active') {
                throw new ApiError(423, 'WALLET_BLOCKED', 'Wallet is blocked');
            }

            const mainAddress = await getMainAddress(tx, walletId);
            const balance = await tx.balanceV2.upsert({
                where: {
                    walletId_asset: {
                        walletId,
                        asset,
                    },
                },
                update: {
                    available: { increment: amount },
                    updatedAt: currentTime,
                },
                create: {
                    walletId,
                    asset,
                    available: amount,
                    locked: 0n,
                    updatedAt: currentTime,
                },
                select: {
                    asset: true,
                    available: true,
                    locked: true,
                    updatedAt: true,
                },
            });

            const txRow = await tx.txV2.create({
                data: {
                    id: crypto.randomUUID(),
                    walletId,
                    fromAddress: WALLET_V2_TESTNET_FAUCET_ADDRESS,
                    toAddress: mainAddress,
                    asset,
                    amount,
                    status: 'completed',
                    meta: {
                        source: 'testnet_faucet',
                    },
                    createdAt: currentTime,
                    confirmedAt: currentTime,
                    completedAt: currentTime,
                },
                select: {
                    id: true,
                    status: true,
                    fromAddress: true,
                    toAddress: true,
                    asset: true,
                    amount: true,
                    createdAt: true,
                    completedAt: true,
                },
            });

            await createAuditEvent({
                tx,
                walletId,
                userId: req.walletV2Auth?.userId,
                event: 'wallet.testnet.topup',
                ipHash,
                userAgent,
                meta: {
                    txId: txRow.id,
                    amount: amount.toString(),
                    asset,
                    source: 'testnet_faucet',
                },
            });

            return {
                balance,
                txRow,
            };
        });

        return res.status(201).json({
            success: true,
            data: {
                walletId,
                network: WALLET_V2_NETWORK,
                balance: {
                    asset: result.balance.asset,
                    available: result.balance.available.toString(),
                    locked: result.balance.locked.toString(),
                    updatedAt: result.balance.updatedAt.toISOString(),
                },
                tx: {
                    id: result.txRow.id,
                    status: result.txRow.status,
                    fromAddress: formatWalletAddress(result.txRow.fromAddress),
                    toAddress: formatWalletAddress(result.txRow.toAddress),
                    asset: result.txRow.asset,
                    amount: result.txRow.amount.toString(),
                    createdAt: result.txRow.createdAt.toISOString(),
                    completedAt: toIsoDate(result.txRow.completedAt),
                },
            },
        });
    } catch (error) {
        if (error instanceof ApiError) {
            return sendError(res, error.statusCode, error.code, error.message, error.details);
        }

        console.error('Wallet v2 testnet topup error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to apply testnet topup');
    }
});

router.post('/tx/create', strictLimit, requireWalletV2Auth, async (req, res) => {
    try {
        const walletId = typeof req.body?.walletId === 'string' ? req.body.walletId.trim() : '';
        const toAddressInput = typeof req.body?.toAddress === 'string' ? req.body.toAddress.trim() : '';
        const normalizedToAddress = toAddressInput
            ? normalizeWalletV2Address(toAddressInput, WALLET_V2_NETWORK)
            : null;
        const recipientAddressCandidates = toAddressInput
            ? buildWalletV2AddressCandidates(toAddressInput, WALLET_V2_NETWORK)
            : [];
        const asset = typeof req.body?.asset === 'string' ? req.body.asset.trim().toUpperCase() : '';
        const amount = parseAmountToBigInt(req.body?.amount);
        const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
        const metadata = req.body?.meta && typeof req.body.meta === 'object'
            ? req.body.meta as Prisma.InputJsonValue
            : undefined;

        if (walletId !== req.walletV2Auth!.walletId) {
            return sendError(res, 403, 'FORBIDDEN', 'Wallet access denied');
        }

        if (!normalizedToAddress || !WALLET_V2_ADDRESS_REGEX_CURRENT.test(normalizedToAddress)) {
            return sendError(
                res,
                400,
                'INVALID_ADDRESS',
                `Address must match ${WALLET_V2_ADDRESS_PREFIX}-${WALLET_V2_ADDRESS_PLACEHOLDER_BODY}`,
            );
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
                        challengeNonce: null,
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
                    challengeNonce,
                };
            }

            const senderAddress = await getMainAddress(tx, walletId);
            const recipientAddress = await tx.addressV2.findFirst({
                where: {
                    address: {
                        in: recipientAddressCandidates,
                    },
                    status: 'active',
                },
                select: {
                    walletId: true,
                    address: true,
                },
            });

            if (!recipientAddress?.walletId || !recipientAddress.address) {
                throw new ApiError(404, 'RECIPIENT_NOT_FOUND', 'Recipient wallet not found');
            }

            if (recipientAddress.walletId === walletId) {
                throw new ApiError(400, 'SELF_TRANSFER', 'Cannot transfer to your own wallet');
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
                    toAddress: recipientAddress.address,
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
                    toAddress: formatWalletAddress(recipientAddress.address),
                    idempotencyKey,
                },
            });

            return {
                created: true,
                tx: createdTx,
                challenge,
                challengeNonce,
            };
        });

        return res.status(txResult.created ? 201 : 200).json({
            success: true,
            data: {
                tx: {
                    id: txResult.tx.id,
                    status: txResult.tx.status,
                    fromAddress: formatWalletAddress(txResult.tx.fromAddress),
                    toAddress: formatWalletAddress(txResult.tx.toAddress),
                    asset: txResult.tx.asset,
                    amount: txResult.tx.amount.toString(),
                    createdAt: txResult.tx.createdAt.toISOString(),
                },
                challenge: {
                    challengeId: txResult.challenge.id,
                    expiresAt: txResult.challenge.expiresAt.toISOString(),
                    methods: ['biometric', 'pin'],
                    challengeNonce: txResult.challengeNonce ?? null,
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
                    nonceHash: true,
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

                const globalPinRecord = await getLatestGlobalPinRecord(tx, {
                    userId: session.wallet.userId,
                    walletId,
                });

                if (!globalPinRecord) {
                    throw new ApiError(404, 'WALLET_NOT_FOUND', 'Wallet not found');
                }

                authValid = await verifySecret(globalPinRecord.pinHash, pin, globalPinRecord.pinSalt);
            } else {
                const deviceId = typeof (authPayload as { deviceId?: unknown }).deviceId === 'string'
                    ? (authPayload as { deviceId: string }).deviceId.trim()
                    : '';
                const signature = typeof (authPayload as { signature?: unknown }).signature === 'string'
                    ? (authPayload as { signature: string }).signature.trim()
                    : '';
                const receivedNonce = typeof (authPayload as { challengeNonce?: unknown }).challengeNonce === 'string'
                    ? (authPayload as { challengeNonce: string }).challengeNonce.trim()
                    : '';

                if (!deviceId || !signature || !receivedNonce) {
                    throw new ApiError(400, 'INVALID_BIOMETRIC', 'Biometric payload is invalid');
                }

                if (deviceId !== session.deviceId) {
                    throw new ApiError(409, 'DEVICE_MISMATCH', 'Device does not match current session');
                }

                if (!session.devicePubkey) {
                    throw new ApiError(401, 'INVALID_BIOMETRIC', 'Biometric authentication is not configured');
                }

                if (!challenge.nonceHash || hashChallengeNonce(receivedNonce) !== challenge.nonceHash) {
                    throw new ApiError(401, 'INVALID_BIOMETRIC', 'Biometric nonce is invalid');
                }

                authValid = verifyEd25519Signature(
                    session.devicePubkey,
                    signature,
                    buildChallengeMessage(txId, challengeId, receivedNonce),
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
