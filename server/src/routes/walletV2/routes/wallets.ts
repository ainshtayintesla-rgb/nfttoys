import { Router } from 'express';

import { prisma } from '../../../lib/db/prisma';
import {
    generateMnemonic24Words,
    generateSalt,
    hashIpAddress,
    hashSecret,
    isValidPin,
    mnemonicFingerprint,
    parseAndNormalizeMnemonicInput,
    verifySecret,
} from '../../../lib/walletV2/security';
import { requireAuth } from '../../../middleware/auth';
import { authLimit, standardLimit } from '../../../middleware/rateLimit';
import { walletV2ImportLimit } from '../../../middleware/walletV2RateLimit';
import { MAX_WALLETS_PER_USER, DEFAULT_ASSET } from '../constants';
import { ipFromRequest, parseDeviceInput, checkFingerprintAttemptDb, recordFingerprintAttemptDb } from '../helpers/authDevice';
import { formatWalletAddress, now, sendError } from '../helpers/utils';
import {
    applyGlobalPinToUserWallets,
    createAuditEvent,
    createUniqueMainAddress,
    ensureUserExists,
    getLatestGlobalPinRecord,
    getMainAddress,
    issueWalletSession,
} from '../helpers/walletDb';
import { Prisma } from '@prisma/client';

const router = Router();

// ---------------------------------------------------------------------------
// List user's wallets (multi-wallet support)
// ---------------------------------------------------------------------------
router.get('/wallets', standardLimit, requireAuth, async (req, res) => {
    try {
        const userId = req.authUser?.uid;

        if (!userId) {
            return sendError(res, 401, 'UNAUTHORIZED', 'Authorization token is required');
        }

        const wallets = await prisma.walletV2.findMany({
            where: { userId, status: 'active' },
            select: {
                id: true,
                status: true,
                createdAt: true,
                addresses: {
                    where: { type: 'main', status: 'active' },
                    select: { address: true },
                    take: 1,
                },
                balances: {
                    select: {
                        asset: true,
                        available: true,
                        locked: true,
                        updatedAt: true,
                    },
                },
            },
            orderBy: { createdAt: 'asc' },
        });

        const items = wallets.map((wallet) => ({
            id: wallet.id,
            address: wallet.addresses[0]?.address || null,
            status: wallet.status,
            createdAt: wallet.createdAt.toISOString(),
            balances: wallet.balances.map((b) => ({
                asset: b.asset,
                available: b.available.toString(),
                locked: b.locked.toString(),
                updatedAt: b.updatedAt.toISOString(),
            })),
        }));

        return res.json({
            success: true,
            data: { wallets: items },
        });
    } catch (error) {
        console.error('List wallets error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to list wallets');
    }
});

// ---------------------------------------------------------------------------
// Switch active wallet session (multi-wallet support)
// ---------------------------------------------------------------------------
router.post('/wallet/switch', authLimit, requireAuth, async (req, res) => {
    try {
        const userId = req.authUser?.uid;

        if (!userId) {
            return sendError(res, 401, 'UNAUTHORIZED', 'Authorization token is required');
        }

        const targetWalletId = typeof req.body?.walletId === 'string' ? req.body.walletId.trim() : '';
        const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
        const device = parseDeviceInput(req.body?.device);

        if (!targetWalletId) {
            return sendError(res, 400, 'INVALID_INPUT', 'walletId is required');
        }

        if (!pin || !isValidPin(pin)) {
            return sendError(res, 400, 'INVALID_PIN', 'PIN is required');
        }

        if (!device) {
            return sendError(res, 400, 'INVALID_DEVICE', 'Device payload is invalid');
        }

        const wallet = await prisma.walletV2.findFirst({
            where: { id: targetWalletId, userId, status: 'active' },
            select: {
                id: true,
                pinHash: true,
                pinSalt: true,
                addresses: {
                    where: { type: 'main', status: 'active' },
                    select: { address: true },
                    take: 1,
                },
            },
        });

        if (!wallet) {
            return sendError(res, 404, 'WALLET_NOT_FOUND', 'Wallet not found');
        }

        const pinValid = verifySecret(pin, wallet.pinHash, wallet.pinSalt);

        if (!pinValid) {
            return sendError(res, 403, 'INVALID_PIN', 'Invalid PIN');
        }

        const ipHash = hashIpAddress(ipFromRequest(req)) || null;
        const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

        const result = await prisma.$transaction(async (tx) => {
            return issueWalletSession(tx, {
                walletId: wallet.id,
                userId,
                device,
                ipHash,
                userAgent,
            });
        });

        await createAuditEvent({
            walletId: wallet.id,
            userId,
            event: 'wallet.switched',
            ipHash,
            userAgent,
            meta: {
                sessionId: result.session.id,
                deviceId: device.deviceId,
            },
        });

        return res.json({
            success: true,
            data: {
                wallet: {
                    id: wallet.id,
                    address: wallet.addresses[0]?.address || '',
                    status: 'active',
                },
                session: {
                    accessToken: result.accessToken,
                    refreshToken: result.refreshToken,
                    expiresInSec: result.expiresInSec,
                },
            },
        });
    } catch (error) {
        console.error('Switch wallet error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to switch wallet');
    }
});

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

export default router;
