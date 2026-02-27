import { Router } from 'express';

import { prisma } from '../lib/db/prisma';
import { parseTelegramId } from '../lib/db/utils';
import { generateWalletAddress, toFriendlyAddress } from '../lib/utils/crypto';
import { requireAuth } from '../middleware/auth';
import { standardLimit, authLimit } from '../middleware/rateLimit';

const router = Router();

// POST /wallet/create
router.post('/create', authLimit, requireAuth, async (req, res) => {
    try {
        const userId = req.authUser!.uid;

        const existingUser = await prisma.user.findUnique({ where: { id: userId } });

        if (existingUser?.walletAddress) {
            return res.json({
                success: true,
                wallet: {
                    address: existingUser.walletAddress,
                    friendlyAddress: existingUser.walletFriendly || toFriendlyAddress(existingUser.walletAddress),
                },
                existing: true,
            });
        }

        const telegramId = parseTelegramId(userId);
        const now = new Date();

        if (!existingUser) {
            await prisma.user.create({
                data: {
                    id: userId,
                    telegramId,
                    createdAt: now,
                    lastLoginAt: now,
                },
            });
        }

        const wallet = generateWalletAddress();
        const friendlyAddress = toFriendlyAddress(wallet.address);

        await prisma.wallet.create({
            data: {
                address: wallet.address,
                friendlyAddress,
                userId,
                addressHash: wallet.addressHash,
                balance: 0,
            },
        });

        await prisma.user.update({
            where: { id: userId },
            data: {
                walletAddress: wallet.address,
                walletFriendly: friendlyAddress,
            },
        });

        return res.json({
            success: true,
            wallet: {
                address: wallet.address,
                friendlyAddress,
            },
            existing: false,
        });
    } catch (error) {
        console.error('Wallet creation error:', error);
        return res.status(500).json({ error: 'Failed to create wallet', code: 'WALLET_ERROR' });
    }
});

// GET /wallet/info
router.get('/info', standardLimit, requireAuth, async (req, res) => {
    try {
        const userId = req.authUser!.uid;

        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (!user) {
            return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
        }

        if (!user.walletAddress) {
            return res.status(404).json({ error: 'User has no wallet', code: 'NO_WALLET' });
        }

        const wallet = await prisma.wallet.findUnique({ where: { address: user.walletAddress } });

        if (!wallet) {
            return res.status(404).json({ error: 'Wallet not found', code: 'WALLET_NOT_FOUND' });
        }

        const nftCount = await prisma.nft.count({ where: { ownerWallet: wallet.address } });

        return res.json({
            success: true,
            wallet: {
                address: wallet.address,
                friendlyAddress: wallet.friendlyAddress || toFriendlyAddress(wallet.address),
                nftCount,
                balance: wallet.balance || 0,
                createdAt: wallet.createdAt ? wallet.createdAt.toISOString() : null,
            },
        });
    } catch (error) {
        console.error('Error fetching wallet:', error);
        return res.status(500).json({ error: 'Failed to fetch wallet', code: 'FETCH_ERROR' });
    }
});

export default router;
