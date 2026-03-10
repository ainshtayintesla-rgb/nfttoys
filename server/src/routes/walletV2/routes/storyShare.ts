import crypto from 'crypto';

import { Router } from 'express';
// Lazy require — sharp is a native module; a static top-level import crashes
// the entire server if the binary is missing. Load on demand so the API stays
// healthy even when sharp isn't available.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp: typeof import('sharp') | null = (() => {
    try { return require('sharp'); }
    catch { console.warn('[storyShare] sharp unavailable – PNG generation disabled'); return null; }
})();

import { prisma } from '../../../lib/db/prisma';
import { standardLimit } from '../../../middleware/rateLimit';
import { strictLimit } from '../../../middleware/rateLimit';
import { requireWalletV2Auth } from '../../../middleware/walletV2Auth';
import {
    NFT_STAKING_REWARD_ASSET,
    NFT_STORY_SHARE_COOLDOWN_HOURS,
    NFT_STORY_SHARE_MAX_STREAK_MULTIPLIER,
    NFT_STORY_SHARE_REVOKED_COOLDOWN_HOURS,
    NFT_STORY_SHARE_STREAK_WINDOW_HOURS,
    WALLET_V2_STAKING_REWARD_SOURCE_ADDRESS,
} from '../constants';
import {
    assertNftStakingPrismaClientReady,
    assertNftStorySharePrismaClientReady,
    handleNftStakingSchemaNotReadyError,
    isNftOwnedByWallet,
    resolveNftStakingRewardPerHour,
    resolveWalletNftStakingContext,
} from '../helpers/staking';
import { escapeXml, now, readCollectionName, sendError } from '../helpers/utils';
import { ApiError } from '../types';

const router = Router();

// ─── POST story-share ─────────────────────────────────────────────────────────
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
            const walletContext = await resolveWalletNftStakingContext(tx, walletId);
            const userId = walletContext.userId || req.walletV2Auth?.userId || null;

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

            const lastShare = await (tx as unknown as { nftStoryShare: { findFirst: Function } }).nftStoryShare.findFirst({
                where: { walletId, tokenId },
                orderBy: { sharedAt: 'desc' },
                select: { id: true, sharedAt: true, streakDay: true, status: true },
            });

            const streakWindowMs = NFT_STORY_SHARE_STREAK_WINDOW_HOURS * 60 * 60 * 1000;

            if (lastShare) {
                const effectiveCooldownHours = lastShare.status === 'revoked'
                    ? NFT_STORY_SHARE_REVOKED_COOLDOWN_HOURS
                    : NFT_STORY_SHARE_COOLDOWN_HOURS;
                const cooldownMs = effectiveCooldownHours * 60 * 60 * 1000;
                const msSinceLast = currentTime.getTime() - lastShare.sharedAt.getTime();
                if (msSinceLast < cooldownMs) {
                    const nextShareAt = new Date(lastShare.sharedAt.getTime() + cooldownMs);
                    throw new ApiError(429, 'STORY_ALREADY_SHARED_TODAY', 'Already shared story for this NFT today', {
                        nextShareAt: nextShareAt.toISOString(),
                    });
                }
            }

            let streakDay = 1;
            if (lastShare) {
                const msSinceLast = currentTime.getTime() - lastShare.sharedAt.getTime();
                if (msSinceLast <= streakWindowMs) {
                    streakDay = Math.min(lastShare.streakDay + 1, 99);
                }
            }

            const rewardPerHour = position.rewardPerHour > 0n
                ? position.rewardPerHour
                : resolveNftStakingRewardPerHour(position.nft?.rarity);

            const multiplier = BigInt(Math.min(streakDay, NFT_STORY_SHARE_MAX_STREAK_MULTIPLIER));
            const bonusAmount = rewardPerHour * multiplier;

            let telegramId: string | null = null;
            if (userId) {
                const userRecord = await tx.user.findUnique({
                    where: { id: userId },
                    select: { telegramId: true },
                });
                telegramId = userRecord?.telegramId || null;
            }

            const BOOST_DURATION_HOURS = 72;
            const boostExpiresAt = new Date(currentTime.getTime() + BOOST_DURATION_HOURS * 60 * 60 * 1000);
            const shareId = crypto.randomUUID();
            const verificationCode = `NT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
            const shareRecord = await (tx as unknown as { nftStoryShare: { create: Function } }).nftStoryShare.create({
                data: {
                    id: shareId,
                    walletId,
                    tokenId,
                    userId,
                    telegramId,
                    sharedAt: currentTime,
                    bonusAmount,
                    boostMultiplier: 1.4,
                    boostExpiresAt,
                    streakDay,
                    status: 'pending',
                    verificationCode,
                    createdAt: currentTime,
                },
            });

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

            return { shareRecord, shareId, bonusAmount, streakDay, balanceRow, txRecord };
        });

        return res.json({
            success: true,
            data: {
                walletId,
                tokenId,
                shareId: result.shareId,
                rewardAsset: NFT_STAKING_REWARD_ASSET,
                streakDay: result.streakDay,
                bonusAmount: result.bonusAmount.toString(),
                boostMultiplier: 1.4,
                boostExpiresAt: result.shareRecord.boostExpiresAt?.toISOString() || null,
                status: 'pending',
                verificationCode: result.shareRecord.verificationCode,
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
        const streakWindowMs = NFT_STORY_SHARE_STREAK_WINDOW_HOURS * 60 * 60 * 1000;

        const lastShare = await (prisma as unknown as { nftStoryShare: { findFirst: Function } }).nftStoryShare.findFirst({
            where: { walletId, tokenId },
            orderBy: { sharedAt: 'desc' },
            select: { id: true, sharedAt: true, streakDay: true, bonusAmount: true, status: true },
        });

        const totalShares = await (prisma as unknown as { nftStoryShare: { count: Function } }).nftStoryShare.count({
            where: { walletId, tokenId },
        });

        let canShare = true;
        let nextShareAt: string | null = null;
        let currentStreak = 1;
        let streakActive = false;

        if (lastShare) {
            const effectiveCooldownHours = lastShare.status === 'revoked'
                ? NFT_STORY_SHARE_REVOKED_COOLDOWN_HOURS
                : NFT_STORY_SHARE_COOLDOWN_HOURS;
            const effectiveCooldownMs = effectiveCooldownHours * 60 * 60 * 1000;
            const msSinceLast = currentTime.getTime() - lastShare.sharedAt.getTime();
            if (msSinceLast < effectiveCooldownMs) {
                canShare = false;
                nextShareAt = new Date(lastShare.sharedAt.getTime() + effectiveCooldownMs).toISOString();
            }
            streakActive = msSinceLast <= streakWindowMs;
            currentStreak = streakActive ? lastShare.streakDay : 1;
        }

        const nextStreakDay = streakActive ? Math.min(currentStreak + 1, 99) : 1;
        const nextMultiplier = Math.min(nextStreakDay, NFT_STORY_SHARE_MAX_STREAK_MULTIPLIER);

        const activePosition = await (prisma as unknown as { nftStakingV2: { findFirst: Function } }).nftStakingV2.findFirst({
            where: { walletId, tokenId, status: 'active' },
            select: { id: true },
        });

        // Check active boost
        let activeBoost: { boostMultiplier: number; boostExpiresAt: string; status: string } | null = null;
        const boostRecord = await (prisma as unknown as { nftStoryShare: { findFirst: Function } }).nftStoryShare.findFirst({
            where: {
                walletId,
                tokenId,
                status: { in: ['verified', 'pending'] },
                boostExpiresAt: { gt: currentTime },
            },
            orderBy: { sharedAt: 'desc' },
            select: { boostMultiplier: true, boostExpiresAt: true, status: true },
        });

        if (boostRecord) {
            activeBoost = {
                boostMultiplier: boostRecord.boostMultiplier,
                boostExpiresAt: boostRecord.boostExpiresAt.toISOString(),
                status: boostRecord.status,
            };
        }

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
                cooldownHours: lastShare?.status === 'revoked'
                    ? NFT_STORY_SHARE_REVOKED_COOLDOWN_HOURS
                    : NFT_STORY_SHARE_COOLDOWN_HOURS,
                streakWindowHours: NFT_STORY_SHARE_STREAK_WINDOW_HOURS,
                maxStreakMultiplier: NFT_STORY_SHARE_MAX_STREAK_MULTIPLIER,
                activeBoost,
            },
        });
    } catch (error) {
        if (error instanceof ApiError) {
            return sendError(res, error.statusCode, error.code, error.message, error.details);
        }

        const schemaErrorResponse = handleNftStakingSchemaNotReadyError({
            res,
            error,
            context: 'Wallet v2 nft story share state',
        });

        if (schemaErrorResponse) return schemaErrorResponse;

        console.error('Wallet v2 nft story share state error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch story share state');
    }
});

// ─── Internal: Get pending story shares for userbot verification ────────────
router.get('/internal/pending-story-shares', async (req, res) => {
    try {
        assertNftStorySharePrismaClientReady();

        const internalSecret = process.env.USERBOT_INTERNAL_SECRET || '';
        const authHeader = req.headers['x-internal-secret'];
        if (!internalSecret || authHeader !== internalSecret) {
            return sendError(res, 403, 'FORBIDDEN', 'Invalid internal secret');
        }

        const pendingShares = await (prisma as unknown as { nftStoryShare: { findMany: Function } }).nftStoryShare.findMany({
            where: {
                status: 'pending',
                boostExpiresAt: { gt: new Date() },
            },
            select: {
                id: true,
                telegramId: true,
                tokenId: true,
                walletId: true,
                sharedAt: true,
                verificationCode: true,
            },
            orderBy: { sharedAt: 'asc' },
            take: 50,
        });

        return res.json({
            success: true,
            shares: pendingShares.map((s: { id: string; telegramId: string | null; tokenId: string; walletId: string; sharedAt: Date; verificationCode: string | null }) => ({
                id: s.id,
                telegramId: s.telegramId,
                tokenId: s.tokenId,
                walletId: s.walletId,
                sharedAt: s.sharedAt.toISOString(),
                verificationCode: s.verificationCode,
            })),
        });
    } catch (error) {
        if (error instanceof ApiError) {
            return sendError(res, error.statusCode, error.code, error.message, error.details);
        }

        const schemaErrorResponse = handleNftStakingSchemaNotReadyError({
            res,
            error,
            context: 'Internal pending story shares',
        });

        if (schemaErrorResponse) return schemaErrorResponse;

        console.error('Internal pending story shares error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch pending shares');
    }
});

// ─── Internal: Active (verified) story shares for re-checking ────────────────
router.get('/internal/active-story-shares', async (req, res) => {
    try {
        assertNftStorySharePrismaClientReady();

        const internalSecret = process.env.USERBOT_INTERNAL_SECRET || '';
        const authHeader = req.headers['x-internal-secret'];
        if (!internalSecret || authHeader !== internalSecret) {
            return sendError(res, 403, 'FORBIDDEN', 'Invalid internal secret');
        }

        const activeShares = await (prisma as unknown as { nftStoryShare: { findMany: Function } }).nftStoryShare.findMany({
            where: {
                status: 'verified',
                boostExpiresAt: { gt: new Date() },
            },
            select: {
                id: true,
                telegramId: true,
                tokenId: true,
                walletId: true,
                sharedAt: true,
                verificationCode: true,
                telegramStoryId: true,
                verifiedAt: true,
            },
            orderBy: { verifiedAt: 'asc' },
            take: 100,
        });

        return res.json({
            success: true,
            shares: activeShares.map((s: { id: string; telegramId: string | null; tokenId: string; walletId: string; sharedAt: Date; verificationCode: string | null; telegramStoryId: number | null; verifiedAt: Date | null }) => ({
                id: s.id,
                telegramId: s.telegramId,
                tokenId: s.tokenId,
                walletId: s.walletId,
                sharedAt: s.sharedAt.toISOString(),
                verificationCode: s.verificationCode,
                telegramStoryId: s.telegramStoryId,
                verifiedAt: s.verifiedAt?.toISOString() || null,
            })),
        });
    } catch (error) {
        if (error instanceof ApiError) {
            return sendError(res, error.statusCode, error.code, error.message, error.details);
        }

        const schemaErrorResponse = handleNftStakingSchemaNotReadyError({
            res,
            error,
            context: 'Internal active story shares',
        });

        if (schemaErrorResponse) return schemaErrorResponse;

        console.error('Internal active story shares error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch active shares');
    }
});

// ─── Internal: Userbot story verification callback ──────────────────────────
router.post('/internal/story-verify', async (req, res) => {
    try {
        assertNftStorySharePrismaClientReady();

        const internalSecret = process.env.USERBOT_INTERNAL_SECRET || '';
        const authHeader = req.headers['x-internal-secret'];
        if (!internalSecret || authHeader !== internalSecret) {
            return sendError(res, 403, 'FORBIDDEN', 'Invalid internal secret');
        }

        const telegramId = typeof req.body?.telegramId === 'string' ? req.body.telegramId : '';
        const verified = req.body?.verified === true;
        const shareId = typeof req.body?.shareId === 'string' ? req.body.shareId.trim() : '';
        const telegramStoryId = typeof req.body?.telegramStoryId === 'number' ? req.body.telegramStoryId : null;

        if (!shareId) {
            return sendError(res, 400, 'SHARE_ID_REQUIRED', 'shareId is required');
        }

        const currentTime = new Date();
        const newStatus = verified ? 'verified' : 'revoked';
        const updateData: Record<string, unknown> = {
            status: newStatus,
        };

        if (verified) {
            updateData.verifiedAt = currentTime;
            if (telegramStoryId !== null) {
                updateData.telegramStoryId = telegramStoryId;
            }
        } else {
            updateData.revokedAt = currentTime;
        }

        await (prisma as unknown as { nftStoryShare: { update: Function } }).nftStoryShare.update({
            where: { id: shareId },
            data: updateData,
        });

        return res.json({ success: true, status: newStatus });
    } catch (error) {
        if (error instanceof ApiError) {
            return sendError(res, error.statusCode, error.code, error.message, error.details);
        }

        const schemaErrorResponse = handleNftStakingSchemaNotReadyError({
            res,
            error,
            context: 'Internal story verify',
        });

        if (schemaErrorResponse) return schemaErrorResponse;

        console.error('Internal story verify error:', error);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to verify story');
    }
});

// ─── Static test story card (no DB dependency) ─────────────────────────────
router.get('/story-card-static.png', standardLimit, async (_req, res) => {
    try {
        const width = 1080;
        const height = 1920;
        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f0f1a"/>
      <stop offset="100%" stop-color="#1a1025"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#d97706"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="${width / 2}" cy="${height * 0.35}" r="160" fill="#f59e0b" opacity="0.12"/>
  <circle cx="${width / 2}" cy="${height * 0.35}" r="100" fill="#f59e0b" opacity="0.2"/>
  <text x="${width / 2}" y="${height * 0.36 + 15}" text-anchor="middle" font-family="Arial,sans-serif" font-size="80" font-weight="bold" fill="#ffffff">NFTToys</text>
  <rect x="${width / 2 - 200}" y="${height * 0.48}" width="400" height="90" rx="24" fill="url(#accent)"/>
  <text x="${width / 2}" y="${height * 0.48 + 60}" text-anchor="middle" font-family="Arial,sans-serif" font-size="44" font-weight="bold" fill="#ffffff">+40% BOOST</text>
  <text x="${width / 2}" y="${height * 0.60}" text-anchor="middle" font-family="Arial,sans-serif" font-size="32" fill="rgba(255,255,255,0.7)">Staking reward boost</text>
  <text x="${width / 2}" y="${height * 0.65}" text-anchor="middle" font-family="Arial,sans-serif" font-size="26" fill="rgba(255,255,255,0.45)">Share a story to earn extra rewards</text>
</svg>`;
        if (!sharp) return res.status(503).send('Image generation unavailable');
        const pngBuffer = await sharp(Buffer.from(svg)).png({ quality: 85 }).toBuffer();
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.send(pngBuffer);
    } catch (error) {
        console.error('Static story card error:', error);
        return res.status(500).send('Failed to generate story card');
    }
});

// ─── Story card image for Telegram story sharing ────────────────────────────
router.get('/story-card/:shareId.png', standardLimit, async (req, res) => {
    try {
        const shareId = req.params.shareId?.trim() || '';
        if (!shareId) {
            return res.status(400).send('Missing shareId');
        }

        assertNftStorySharePrismaClientReady();

        const share = await (prisma as unknown as { nftStoryShare: { findUnique: Function } }).nftStoryShare.findUnique({
            where: { id: shareId },
            select: {
                id: true,
                verificationCode: true,
                tokenId: true,
                boostMultiplier: true,
            },
        });

        if (!share) {
            return res.status(404).send('Share not found');
        }

        const nft = await prisma.nft.findUnique({
            where: { tokenId: share.tokenId },
            select: { metadata: true, serialNumber: true, rarity: true },
        });

        const width = 1080;
        const height = 1920;
        const nftName = nft
            ? `${readCollectionName(nft.metadata)}${nft.serialNumber ? ' #' + nft.serialNumber : ''}`
            : share.tokenId.slice(0, 12);
        const rarity = nft?.rarity || 'common';
        const boostPct = Math.round((share.boostMultiplier - 1) * 100);
        const code = share.verificationCode || '';

        const rarityColor = rarity === 'legendary' ? '#fbbf24' : rarity === 'rare' ? '#3b82f6' : '#9ca3af';
        const gradTop = '#0f0f1a';
        const gradBot = '#1a1025';

        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${gradTop}"/>
      <stop offset="100%" stop-color="${gradBot}"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#d97706"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="30" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="${width / 2}" cy="${height * 0.38}" r="200" fill="${rarityColor}" opacity="0.08" filter="url(#glow)"/>
  <circle cx="${width / 2}" cy="${height * 0.38}" r="120" fill="${rarityColor}" opacity="0.15"/>
  <text x="${width / 2}" y="${height * 0.38 + 15}" text-anchor="middle" font-family="Arial,sans-serif" font-size="72" font-weight="bold" fill="#ffffff">NFT</text>
  <text x="${width / 2}" y="${height * 0.52}" text-anchor="middle" font-family="Arial,sans-serif" font-size="52" font-weight="bold" fill="#ffffff">${escapeXml(nftName)}</text>
  <rect x="${width / 2 - 100}" y="${height * 0.55}" width="200" height="40" rx="20" fill="${rarityColor}" opacity="0.25"/>
  <text x="${width / 2}" y="${height * 0.55 + 28}" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" font-weight="bold" fill="${rarityColor}" text-transform="uppercase">${rarity.toUpperCase()}</text>
  <rect x="${width / 2 - 180}" y="${height * 0.63}" width="360" height="80" rx="20" fill="url(#accent)"/>
  <text x="${width / 2}" y="${height * 0.63 + 52}" text-anchor="middle" font-family="Arial,sans-serif" font-size="40" font-weight="bold" fill="#ffffff">+${boostPct}% BOOST</text>
  <text x="${width / 2}" y="${height * 0.73}" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" fill="rgba(255,255,255,0.6)">Staking boost active for 3 days</text>
  <text x="${width / 2}" y="${height * 0.85}" text-anchor="middle" font-family="Arial,sans-serif" font-size="48" font-weight="bold" fill="url(#accent)">NFTToys</text>
  <text x="${width / 2}" y="${height * 0.89}" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" fill="rgba(255,255,255,0.35)">${escapeXml(code)}</text>
</svg>`;

        if (!sharp) return res.status(503).send('Image generation unavailable');
        const pngBuffer = await sharp(Buffer.from(svg)).png({ quality: 85 }).toBuffer();

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(pngBuffer);
    } catch (error) {
        console.error('Story card generation error:', error);
        return res.status(500).send('Failed to generate story card');
    }
});

export default router;
