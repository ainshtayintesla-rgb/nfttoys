import { Router } from 'express';
import crypto from 'crypto';
import argon2 from 'argon2';

import { prisma } from '../lib/db/prisma';
import { requireAuth } from '../middleware/auth';
import { requireOwner } from '../middleware/owner';
import { standardLimit, strictLimit } from '../middleware/rateLimit';

const router = Router();

// All owner routes require Telegram auth + owner check
router.use(requireAuth, requireOwner);

// ── Health / Ping ─────────────────────────────────────────────────────────────

router.get('/health', standardLimit, async (_req, res) => {
    const start = Date.now();
    try {
        await prisma.$queryRaw`SELECT 1`;
        return res.json({
            success: true,
            status: 'ok',
            dbPingMs: Date.now() - start,
            uptimeSeconds: Math.round(process.uptime()),
            timestamp: new Date().toISOString(),
            nodeVersion: process.version,
            memMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        });
    } catch {
        return res.status(500).json({
            success: false,
            status: 'db_error',
            dbPingMs: null,
        });
    }
});

// ── System Info ───────────────────────────────────────────────────────────────

router.get('/info', standardLimit, async (_req, res) => {
    try {
        const [userCount, nftCount, adminCount, qrCount] = await Promise.all([
            prisma.user.count(),
            prisma.nft.count(),
            prisma.adminAccount.count(),
            prisma.qrCode.count(),
        ]);

        return res.json({
            success: true,
            info: {
                users: userCount,
                nfts: nftCount,
                admins: adminCount,
                qrCodes: qrCount,
                nodeVersion: process.version,
                uptimeSeconds: Math.round(process.uptime()),
                memMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                env: process.env.NODE_ENV || 'production',
            },
        });
    } catch (error) {
        console.error('Owner info error:', error);
        return res.status(500).json({ error: 'Failed to fetch info', code: 'INFO_FAILED' });
    }
});

// ── Users ─────────────────────────────────────────────────────────────────────

router.get('/users', standardLimit, async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const offset = Number(req.query.offset) || 0;
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

        const where = search
            ? {
                OR: [
                    { username: { contains: search, mode: 'insensitive' as const } },
                    { firstName: { contains: search, mode: 'insensitive' as const } },
                    { telegramId: { contains: search } },
                ],
            }
            : {};

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                take: limit,
                skip: offset,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    telegramId: true,
                    username: true,
                    firstName: true,
                    createdAt: true,
                    lastLoginAt: true,
                    walletAddress: true,
                    _count: { select: { ownedNfts: true } },
                },
            }),
            prisma.user.count({ where }),
        ]);

        return res.json({
            success: true,
            users: users.map((u) => ({
                ...u,
                nftCount: u._count.ownedNfts,
                _count: undefined,
            })),
            total,
            limit,
            offset,
        });
    } catch (error) {
        console.error('Owner users error:', error);
        return res.status(500).json({ error: 'Failed to fetch users', code: 'USERS_FAILED' });
    }
});

// ── Admins management ─────────────────────────────────────────────────────────

router.get('/admins', standardLimit, async (_req, res) => {
    try {
        const admins = await prisma.adminAccount.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                telegramId: true,
                login: true,
                createdAt: true,
                lastLoginAt: true,
            },
        });
        return res.json({ success: true, admins });
    } catch (error) {
        console.error('Owner admins list error:', error);
        return res.status(500).json({ error: 'Failed to fetch admins', code: 'ADMINS_FAILED' });
    }
});

router.post('/admins', strictLimit, async (req, res) => {
    try {
        const telegramId = String(req.body?.telegramId || '').trim();
        if (!telegramId || !/^\d{5,}$/.test(telegramId)) {
            return res.status(400).json({
                error: 'Valid numeric Telegram ID required (min 5 digits)',
                code: 'INVALID_TELEGRAM_ID',
            });
        }

        const existing = await prisma.adminAccount.findUnique({ where: { telegramId } });
        if (existing) {
            return res.status(409).json({
                error: 'Admin with this Telegram ID already exists',
                code: 'ALREADY_EXISTS',
                login: existing.login,
            });
        }

        // Generate unique login: admin_<last6digits>
        const baseLogin = `admin_${telegramId.slice(-6)}`;
        let login = baseLogin;
        let attempt = 1;
        while (await prisma.adminAccount.findUnique({ where: { login } })) {
            login = `${baseLogin}_${attempt++}`;
        }

        // Generate 12-char alphanumeric password
        const tempPassword = crypto.randomBytes(8).toString('base64url').slice(0, 12);
        const passwordHash = await argon2.hash(tempPassword);

        const account = await prisma.adminAccount.create({
            data: { telegramId, login, passwordHash },
            select: { id: true, telegramId: true, login: true, createdAt: true },
        });

        return res.json({ success: true, admin: account, tempPassword });
    } catch (error) {
        console.error('Owner add admin error:', error);
        return res.status(500).json({ error: 'Failed to add admin', code: 'ADD_ADMIN_FAILED' });
    }
});

router.delete('/admins/:id', strictLimit, async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.adminAccount.delete({ where: { id } });
        return res.json({ success: true });
    } catch {
        return res.status(404).json({ error: 'Admin not found', code: 'NOT_FOUND' });
    }
});

// Reset admin credentials (generates new temp password)
router.post('/admins/:id/reset', strictLimit, async (req, res) => {
    try {
        const { id } = req.params;
        const account = await prisma.adminAccount.findUnique({
            where: { id },
            select: { id: true, login: true },
        });
        if (!account) {
            return res.status(404).json({ error: 'Admin not found', code: 'NOT_FOUND' });
        }

        const tempPassword = crypto.randomBytes(8).toString('base64url').slice(0, 12);
        const passwordHash = await argon2.hash(tempPassword);
        await prisma.adminAccount.update({ where: { id }, data: { passwordHash } });

        return res.json({ success: true, login: account.login, tempPassword });
    } catch (error) {
        console.error('Owner reset admin error:', error);
        return res.status(500).json({ error: 'Failed to reset admin', code: 'RESET_FAILED' });
    }
});

export default router;
