import { Router } from 'express';

import { prisma } from '../lib/db/prisma';
import { fetchBotMeta } from '../lib/utils/telegramBot';
import { requireAuth } from '../middleware/auth';
import { standardLimit } from '../middleware/rateLimit';

const router = Router();

// GET /referrals/overview
router.get('/overview', standardLimit, requireAuth, async (req, res) => {
    try {
        const userId = req.authUser!.uid;

        const currentUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { telegramId: true },
        });

        if (!currentUser?.telegramId) {
            return res.status(400).json({
                error: 'Telegram account is not linked',
                code: 'TELEGRAM_ID_REQUIRED',
            });
        }

        const joinedUsers = await prisma.user.findMany({
            where: {
                referrerId: userId,
            },
            orderBy: {
                referredAt: 'desc',
            },
            take: 200,
            select: {
                id: true,
                username: true,
                firstName: true,
                photoUrl: true,
                referredAt: true,
                createdAt: true,
            },
        });

        let botUsername: string | null = null;
        const botMetaResult = await fetchBotMeta();
        if (botMetaResult.ok && botMetaResult.data?.username) {
            botUsername = botMetaResult.data.username;
        }

        return res.json({
            success: true,
            referral: {
                referralCode: String(currentUser.telegramId),
                botUsername,
                total: joinedUsers.length,
                joined: joinedUsers.map((joinedUser) => ({
                    id: joinedUser.id,
                    username: joinedUser.username,
                    firstName: joinedUser.firstName,
                    photoUrl: joinedUser.photoUrl,
                    joinedAt: (joinedUser.referredAt || joinedUser.createdAt).toISOString(),
                })),
            },
        });
    } catch (error) {
        console.error('Failed to get referral overview:', error);
        return res.status(500).json({
            error: 'Failed to load referral overview',
            code: 'REFERRAL_FETCH_ERROR',
        });
    }
});

export default router;
