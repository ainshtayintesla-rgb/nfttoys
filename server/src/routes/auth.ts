import { Router } from 'express';
import crypto from 'crypto';

import { prisma } from '../lib/db/prisma';
import { normalizedUsername } from '../lib/db/utils';
import { signAuthToken } from '../lib/auth/jwt';
import { generateWalletAddress, toFriendlyAddress } from '../lib/utils/crypto';
import { updateWriteAccessStatus } from '../lib/utils/telegramBot';
import { authLimit } from '../middleware/rateLimit';

const router = Router();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

interface TelegramUser {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    photo_url?: string;
    allows_write_to_pm?: boolean;
}

interface TelegramVerificationResult {
    valid: boolean;
    user?: TelegramUser;
    startParam?: string | null;
}

function parseReferralTelegramId(startParam: string | null | undefined, currentTelegramId: number): string | null {
    if (!startParam) {
        return null;
    }

    const normalizedParam = startParam.trim();
    const match = /^ref_(\d{5,20})$/i.exec(normalizedParam);
    if (!match) {
        return null;
    }

    const referrerTelegramId = match[1] || null;
    if (!referrerTelegramId || referrerTelegramId === String(currentTelegramId)) {
        return null;
    }

    return referrerTelegramId;
}

// Verify Telegram initData signature
function verifyTelegramData(initData: string): TelegramVerificationResult {
    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');

        if (!hash) {
            return { valid: false };
        }

        // Check auth_date expiry (24 hours max)
        const authDate = Number.parseInt(params.get('auth_date') || '0', 10);
        const now = Math.floor(Date.now() / 1000);
        const maxAge = 86400;

        if (now - authDate > maxAge) {
            console.warn('Telegram auth_date expired');
            return { valid: false };
        }

        const startParam = params.get('start_param');

        params.delete('hash');

        const sortedParams = Array.from(params.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        const secretKey = crypto
            .createHmac('sha256', 'WebAppData')
            .update(BOT_TOKEN)
            .digest();

        const expectedHash = crypto
            .createHmac('sha256', secretKey)
            .update(sortedParams)
            .digest('hex');

        if (hash.length !== expectedHash.length) {
            return { valid: false };
        }

        if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash))) {
            return { valid: false };
        }

        const userStr = params.get('user');
        if (!userStr) {
            return { valid: false };
        }

        const user = JSON.parse(userStr) as TelegramUser;
        return {
            valid: true,
            user,
            startParam: startParam?.trim() || null,
        };
    } catch (error) {
        console.error('Error verifying Telegram data:', error);
        return { valid: false };
    }
}

// POST /auth/telegram
router.post('/telegram', authLimit, async (req, res) => {
    try {
        const { initData } = req.body;

        if (!initData) {
            return res.status(400).json({ error: 'initData is required' });
        }

        const verification = verifyTelegramData(initData);

        if (!verification.valid || !verification.user) {
            return res.status(401).json({
                error: 'Invalid Telegram data',
                code: 'INVALID_SIGNATURE',
            });
        }

        const user = verification.user;
        const uid = `telegram_${user.id}`;

        const accessToken = signAuthToken({
            uid,
            telegramId: user.id,
            firstName: user.first_name,
            lastName: user.last_name,
            username: user.username,
        });

        const now = new Date();
        const username = user.username?.trim() || null;
        const referrerTelegramId = parseReferralTelegramId(verification.startParam, user.id);

        const referralCreateData: { referrerId?: string; referredAt?: Date } = {};
        if (referrerTelegramId) {
            const referrerUser = await prisma.user.findUnique({
                where: { telegramId: referrerTelegramId },
                select: { id: true },
            });

            if (referrerUser?.id && referrerUser.id !== uid) {
                referralCreateData.referrerId = referrerUser.id;
                referralCreateData.referredAt = now;
            }
        }

        await prisma.user.upsert({
            where: { id: uid },
            create: {
                id: uid,
                telegramId: String(user.id),
                firstName: user.first_name,
                lastName: user.last_name || null,
                username,
                usernameLower: normalizedUsername(username),
                photoUrl: user.photo_url || null,
                languageCode: user.language_code || null,
                createdAt: now,
                lastLoginAt: now,
                ...referralCreateData,
            },
            update: {
                telegramId: String(user.id),
                firstName: user.first_name,
                lastName: user.last_name || null,
                username,
                usernameLower: normalizedUsername(username),
                photoUrl: user.photo_url || null,
                languageCode: user.language_code || null,
                lastLoginAt: now,
            },
        });

        let currentUser = await prisma.user.findUnique({ where: { id: uid } });
        let walletAddress = currentUser?.walletAddress ?? null;
        let walletFriendly = currentUser?.walletFriendly ?? null;

        if (!walletAddress) {
            const wallet = generateWalletAddress();
            walletAddress = wallet.address;
            walletFriendly = toFriendlyAddress(wallet.address);

            await prisma.wallet.create({
                data: {
                    address: wallet.address,
                    friendlyAddress: walletFriendly,
                    userId: uid,
                    addressHash: wallet.addressHash,
                    balance: 0,
                },
            });

            currentUser = await prisma.user.update({
                where: { id: uid },
                data: {
                    walletAddress,
                    walletFriendly,
                },
            });
        } else {
            const existingWallet = await prisma.wallet.findUnique({ where: { address: walletAddress } });
            const normalizedFriendly = toFriendlyAddress(walletAddress);

            if (!existingWallet) {
                await prisma.wallet.create({
                    data: {
                        address: walletAddress,
                        friendlyAddress: normalizedFriendly,
                        userId: uid,
                        addressHash: walletAddress.slice(3),
                        balance: 0,
                    },
                });
            } else {
                const walletUpdateData: {
                    userId?: string;
                    friendlyAddress?: string;
                } = {};

                if (!existingWallet.userId) {
                    walletUpdateData.userId = uid;
                }

                if (existingWallet.friendlyAddress !== normalizedFriendly) {
                    walletUpdateData.friendlyAddress = normalizedFriendly;
                }

                if (Object.keys(walletUpdateData).length > 0) {
                    await prisma.wallet.update({
                        where: { address: walletAddress },
                        data: walletUpdateData,
                    });
                }
            }

            if (currentUser?.walletFriendly !== normalizedFriendly) {
                currentUser = await prisma.user.update({
                    where: { id: uid },
                    data: { walletFriendly: normalizedFriendly },
                });
            }

            walletFriendly = normalizedFriendly;
        }

        if (typeof user.allows_write_to_pm === 'boolean') {
            const writeStatus = user.allows_write_to_pm ? 'allowed' : 'denied';

            void updateWriteAccessStatus({
                telegramId: String(user.id),
                status: writeStatus,
            }).catch((syncError) => {
                console.warn('Failed to sync Telegram write-access status:', syncError);
            });
        }

        return res.json({
            success: true,
            token: accessToken,
            tokenType: 'Bearer',
            expiresIn: process.env.JWT_EXPIRES_IN || '7d',
            user: {
                uid,
                telegramId: user.id,
                firstName: user.first_name,
                lastName: user.last_name,
                username: user.username,
                photoUrl: user.photo_url,
                walletAddress: currentUser?.walletAddress || walletAddress,
                walletFriendly: currentUser?.walletFriendly || walletFriendly,
            },
        });
    } catch (error) {
        console.error('Auth error:', error);
        return res.status(500).json({ error: 'Authentication failed' });
    }
});

export default router;
