import crypto from 'crypto';

import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { prisma } from '../../../lib/db/prisma';
import { hashIpAddress } from '../../../lib/walletV2/security';
import { strictLimit, standardLimit } from '../../../middleware/rateLimit';
import { requireWalletV2Auth } from '../../../middleware/walletV2Auth';
import {
    NFT_STAKING_REWARD_ASSET,
    NFT_STAKING_UNSTAKE_COOLDOWN_HOURS,
    NFT_STAKING_WINDOW_END_HOURS,
    NFT_STAKING_WINDOW_START_HOURS,
} from '../constants';
import { ipFromRequest } from '../helpers/authDevice';
import {
    assertNftStakingPrismaClientReady,
    buildNftOwnershipWhere,
    buildStakeWindow,
    computeNftStakingPendingReward,
    creditNftStakingReward,
    handleNftStakingSchemaNotReadyError,
    isNftOwnedByWallet,
    resolveNftStakingRewardPerHour,
    resolveWalletNftStakingContext,
} from '../helpers/staking';
import { addHours, formatWalletAddress, now, readCollectionName, sendError, toIsoDate } from '../helpers/utils';
import { createAuditEvent } from '../helpers/walletDb';
import { ApiError, WalletNftOwnershipContext } from '../types';

const router = Router();

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

            // Load active story boosts for this wallet
            type ActiveBoostInfo = { multiplier: number; startedAt: Date };
            let activeBoostsByToken: Map<string, ActiveBoostInfo> = new Map();
            try {
                const nftStoryShareDelegate = (tx as unknown as { nftStoryShare?: { findMany: Function } }).nftStoryShare;
                if (nftStoryShareDelegate) {
                    const activeBoosts = await nftStoryShareDelegate.findMany({
                        where: {
                            walletId,
                            status: { in: ['verified', 'pending'] },
                            boostExpiresAt: { gt: currentTime },
                        },
                        select: { tokenId: true, boostMultiplier: true, sharedAt: true },
                    });
                    for (const boost of activeBoosts) {
                        const current = activeBoostsByToken.get(boost.tokenId);
                        if (!current || boost.boostMultiplier > current.multiplier) {
                            activeBoostsByToken.set(boost.tokenId, {
                                multiplier: boost.boostMultiplier,
                                startedAt: boost.sharedAt,
                            });
                        }
                    }
                }
            } catch {
                // Story share schema may not be ready
            }

            let pendingRewardTotal = 0n;
            let totalClaimed = 0n;
            const positionRows = activePositions.map((position) => {
                const nft = position.nft;
                const baseRewardPerHour = position.rewardPerHour > 0n
                    ? position.rewardPerHour
                    : resolveNftStakingRewardPerHour(nft?.rarity);

                const activeBoost = activeBoostsByToken.get(position.tokenId);

                const pending = computeNftStakingPendingReward({
                    lastClaimAt: position.lastClaimAt,
                    rewardPerHour: baseRewardPerHour,
                    currentTime,
                    boost: activeBoost,
                });

                const rewardPerHour = activeBoost && activeBoost.multiplier > 1
                    ? BigInt(Math.floor(Number(baseRewardPerHour) * activeBoost.multiplier))
                    : baseRewardPerHour;
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

            const baseRewardPerHour = position.rewardPerHour > 0n
                ? position.rewardPerHour
                : resolveNftStakingRewardPerHour(position.nft.rarity);

            // Apply story boost multiplier if active
            let claimBoostMultiplier = 1;
            try {
                const nftStoryShareDelegate = (tx as unknown as { nftStoryShare?: { findFirst: Function } }).nftStoryShare;
                if (nftStoryShareDelegate) {
                    const activeBoost = await nftStoryShareDelegate.findFirst({
                        where: {
                            walletId,
                            tokenId,
                            status: { in: ['verified', 'pending'] },
                            boostExpiresAt: { gt: currentTime },
                        },
                        orderBy: { boostMultiplier: 'desc' },
                        select: { boostMultiplier: true },
                    });
                    if (activeBoost) {
                        claimBoostMultiplier = activeBoost.boostMultiplier;
                    }
                }
            } catch {
                // Story share schema may not be ready
            }

            const rewardPerHour = claimBoostMultiplier > 1
                ? BigInt(Math.floor(Number(baseRewardPerHour) * claimBoostMultiplier))
                : baseRewardPerHour;

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

            const baseRewardPerHourUnstake = position.rewardPerHour > 0n
                ? position.rewardPerHour
                : resolveNftStakingRewardPerHour(position.nft?.rarity);

            // Apply story boost for unstake+claim
            let unstakeBoostMultiplier = 1;
            try {
                const nftStoryShareDelegate = (tx as unknown as { nftStoryShare?: { findFirst: Function } }).nftStoryShare;
                if (nftStoryShareDelegate) {
                    const activeBoost = await nftStoryShareDelegate.findFirst({
                        where: {
                            walletId,
                            tokenId,
                            status: { in: ['verified', 'pending'] },
                            boostExpiresAt: { gt: currentTime },
                        },
                        orderBy: { boostMultiplier: 'desc' },
                        select: { boostMultiplier: true },
                    });
                    if (activeBoost) {
                        unstakeBoostMultiplier = activeBoost.boostMultiplier;
                    }
                }
            } catch {
                // Story share schema may not be ready
            }

            const rewardPerHour = unstakeBoostMultiplier > 1
                ? BigInt(Math.floor(Number(baseRewardPerHourUnstake) * unstakeBoostMultiplier))
                : baseRewardPerHourUnstake;

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

export default router;
