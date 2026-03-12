import { Router } from 'express';
import crypto from 'crypto';
import argon2 from 'argon2';

import { prisma } from '../lib/db/prisma';
import { signAdminSessionToken, requireAdminSession, AdminSessionPayload } from '../middleware/adminSession';
import { strictLimit, standardLimit } from '../middleware/rateLimit';

const router = Router();

// ── Login ─────────────────────────────────────────────────────────────────────

router.post('/login', strictLimit, async (req, res) => {
    try {
        const login = typeof req.body?.login === 'string' ? req.body.login.trim() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';

        if (!login || !password) {
            return res.status(400).json({
                error: 'Login and password are required',
                code: 'MISSING_CREDENTIALS',
            });
        }

        const account = await prisma.adminAccount.findUnique({
            where: { login },
            select: { id: true, login: true, passwordHash: true },
        });

        if (!account) {
            return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
        }

        const valid = await argon2.verify(account.passwordHash, password);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
        }

        await prisma.adminAccount.update({
            where: { id: account.id },
            data: { lastLoginAt: new Date() },
        });

        const token = signAdminSessionToken(account.id, account.login);
        return res.json({ success: true, token, login: account.login });
    } catch (error) {
        console.error('Admin login error:', error);
        return res.status(500).json({ error: 'Login failed', code: 'LOGIN_FAILED' });
    }
});

// ── Change password ───────────────────────────────────────────────────────────

router.post('/change-password', requireAdminSession, strictLimit, async (req, res) => {
    try {
        const session = (req as typeof req & { adminSession: AdminSessionPayload }).adminSession;
        const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
        const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: 'currentPassword and newPassword are required',
                code: 'MISSING_FIELDS',
            });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                error: 'New password must be at least 8 characters',
                code: 'PASSWORD_TOO_SHORT',
            });
        }

        const account = await prisma.adminAccount.findUnique({
            where: { id: session.adminId },
            select: { id: true, passwordHash: true },
        });

        if (!account) {
            return res.status(404).json({ error: 'Account not found', code: 'NOT_FOUND' });
        }

        const valid = await argon2.verify(account.passwordHash, currentPassword);
        if (!valid) {
            return res.status(401).json({ error: 'Current password is incorrect', code: 'INVALID_PASSWORD' });
        }

        const newHash = await argon2.hash(newPassword);
        await prisma.adminAccount.update({ where: { id: account.id }, data: { passwordHash: newHash } });

        return res.json({ success: true });
    } catch (error) {
        console.error('Admin change-password error:', error);
        return res.status(500).json({ error: 'Failed to change password', code: 'CHANGE_PASSWORD_FAILED' });
    }
});

// ── Whoami ────────────────────────────────────────────────────────────────────

router.get('/me', requireAdminSession, standardLimit, async (req, res) => {
    const session = (req as typeof req & { adminSession: AdminSessionPayload }).adminSession;
    return res.json({ success: true, login: session.login, adminId: session.adminId });
});

// ── /pin bot endpoint ─────────────────────────────────────────────────────────
// Called by the Telegram bot when an admin writes /pin.
// Auth: Authorization: Bearer <BOT_SERVICE_TOKEN>

function isBotAuthorized(req: { headers: { authorization?: string } }): boolean {
    const token = process.env.BOT_SERVICE_TOKEN || '';
    if (!token) return false;
    const authHeader = req.headers.authorization || '';
    return authHeader === `Bearer ${token}`;
}

router.post('/pin', strictLimit, async (req, res) => {
    if (!isBotAuthorized(req)) {
        return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    try {
        const telegramId = String(req.body?.telegramId || '').trim();
        if (!telegramId || !/^\d+$/.test(telegramId)) {
            return res.status(400).json({ error: 'telegramId is required', code: 'INVALID_TELEGRAM_ID' });
        }

        const account = await prisma.adminAccount.findUnique({
            where: { telegramId },
            select: { id: true, login: true },
        });

        if (!account) {
            return res.status(404).json({
                error: 'No admin account found for this Telegram ID',
                code: 'NOT_FOUND',
            });
        }

        // Generate new temp password and update hash
        const tempPassword = crypto.randomBytes(8).toString('base64url').slice(0, 12);
        const passwordHash = await argon2.hash(tempPassword);
        await prisma.adminAccount.update({ where: { id: account.id }, data: { passwordHash } });

        return res.json({ success: true, login: account.login, password: tempPassword });
    } catch (error) {
        console.error('Admin /pin error:', error);
        return res.status(500).json({ error: 'Failed to generate PIN', code: 'PIN_FAILED' });
    }
});

export default router;
