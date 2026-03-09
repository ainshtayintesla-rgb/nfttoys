import { Router } from 'express';

import { prisma } from '../../../lib/db/prisma';
import {
    buildChallengeMessage,
    buildWalletV2AddressCandidates,
    generateChallengeNonce,
    hashChallengeNonce,
    hashIpAddress,
    isValidPin,
    normalizeWalletV2Address,
    parseAmountToBigInt,
    verifyEd25519Signature,
    verifySecret,
} from '../../../lib/walletV2/security';
import { strictLimit } from '../../../middleware/rateLimit';
import { requireWalletV2Auth } from '../../../middleware/walletV2Auth';
import {
    CHALLENGE_TTL_SEC,
    DEFAULT_ASSET,
    VALID_ASSET_REGEX,
    VALID_IDEMPOTENCY_KEY_REGEX,
    WALLET_V2_ADDRESS_PLACEHOLDER_BODY,
    WALLET_V2_ADDRESS_PREFIX,
    WALLET_V2_ADDRESS_REGEX_CURRENT,
    WALLET_V2_NETWORK,
    WALLET_V2_TESTNET_FAUCET_ADDRESS,
    WALLET_V2_TESTNET_TOPUP_MAX_AMOUNT,
} from '../constants';
import { ipFromRequest } from '../helpers/authDevice';
import { formatWalletAddress, now, sendError, toIsoDate } from '../helpers/utils';
import { cancelPendingTxAndReleaseLocked, createAuditEvent, getLatestGlobalPinRecord, getMainAddress } from '../helpers/walletDb';
import { ApiError } from '../types';
import { Prisma } from '@prisma/client';

const router = Router();

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
