import crypto from 'crypto';

import { Prisma } from '@prisma/client';
import { Response } from 'express';

import { prisma } from '../../../lib/db/prisma';
import {
    NFT_STAKING_DEFAULT_REWARD_PER_HOUR,
    NFT_STAKING_REWARD_ASSET,
    NFT_STAKING_REWARD_PER_HOUR_BY_RARITY,
    NFT_STAKING_UNSTAKE_COOLDOWN_HOURS,
    NFT_STAKING_WINDOW_END_HOURS,
    NFT_STAKING_WINDOW_START_HOURS,
    WALLET_V2_STAKING_REWARD_SOURCE_ADDRESS,
} from '../constants';
import { ApiError, NftStakingWindow, WalletNftOwnershipContext } from '../types';
import { addHours, sendError } from './utils';
import { getMainAddress } from './walletDb';

export function resolveNftStakingRewardPerHour(rarityInput: string | null | undefined): bigint {
    const rarity = (rarityInput || '').trim().toLowerCase();

    if (rarity && NFT_STAKING_REWARD_PER_HOUR_BY_RARITY[rarity] !== undefined) {
        return NFT_STAKING_REWARD_PER_HOUR_BY_RARITY[rarity];
    }

    return NFT_STAKING_DEFAULT_REWARD_PER_HOUR;
}

export function buildStakeWindow(anchorAt: Date, currentTime: Date): NftStakingWindow {
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

export function computeNftStakingPendingReward(params: {
    lastClaimAt: Date;
    rewardPerHour: bigint;
    currentTime: Date;
    boost?: { multiplier: number; startedAt: Date };
}): {
    amount: bigint;
    elapsedWholeHours: number;
    nextClaimAt: Date;
} {
    const elapsedMs = params.currentTime.getTime() - params.lastClaimAt.getTime();
    const elapsedWholeHours = elapsedMs > 0
        ? Math.floor(elapsedMs / (60 * 60 * 1000))
        : 0;

    let amount: bigint;
    const boost = params.boost;
    if (boost && boost.multiplier > 1 && boost.startedAt > params.lastClaimAt) {
        // Only apply boost to hours that started AFTER the boost was activated.
        // Pre-boost hours: whole hours elapsed from lastClaimAt up to boostStartedAt.
        // Post-boost hours: remainder of total elapsed hours.
        const preBoostMs = boost.startedAt.getTime() - params.lastClaimAt.getTime();
        const preBoostHours = preBoostMs > 0 ? Math.floor(preBoostMs / (60 * 60 * 1000)) : 0;
        const boostedHours = Math.max(0, elapsedWholeHours - preBoostHours);
        const boostedRewardPerHour = BigInt(Math.floor(Number(params.rewardPerHour) * boost.multiplier));
        amount = BigInt(preBoostHours) * params.rewardPerHour + BigInt(boostedHours) * boostedRewardPerHour;
    } else {
        amount = BigInt(elapsedWholeHours) * params.rewardPerHour;
    }

    return {
        amount,
        elapsedWholeHours,
        nextClaimAt: addHours(params.lastClaimAt, 1),
    };
}

export function isNftOwnedByWallet(params: {
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

export function buildNftOwnershipWhere(ownership: WalletNftOwnershipContext): Prisma.NftWhereInput {
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

export async function resolveWalletNftStakingContext(tx: Prisma.TransactionClient, walletId: string): Promise<{
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

export function assertNftStakingPrismaClientReady(): void {
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

export function assertNftStorySharePrismaClientReady(): void {
    const delegate = (prisma as unknown as { nftStoryShare?: unknown }).nftStoryShare;
    if (delegate !== undefined) return;
    throw new ApiError(
        503,
        'NFT_STORY_SHARE_SCHEMA_NOT_READY',
        'NFT story share database schema is not initialized',
    );
}

export function handleNftStakingSchemaNotReadyError(params: {
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

export async function creditNftStakingReward(
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
