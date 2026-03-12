import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export interface AdminSessionPayload {
    type: 'admin_session';
    adminId: string;
    login: string;
}

const SESSION_TTL = '24h';

function getSecret(): string {
    return process.env.JWT_SECRET || process.env.TOKEN_SECRET || '';
}

export function signAdminSessionToken(adminId: string, login: string): string {
    const payload: AdminSessionPayload = { type: 'admin_session', adminId, login };
    return jwt.sign(payload, getSecret(), { expiresIn: SESSION_TTL });
}

export function verifyAdminSessionToken(token: string): AdminSessionPayload | null {
    try {
        const decoded = jwt.verify(token, getSecret());
        if (typeof decoded === 'string' || decoded.type !== 'admin_session') return null;
        if (typeof decoded.adminId !== 'string' || typeof decoded.login !== 'string') return null;
        return { type: 'admin_session', adminId: decoded.adminId as string, login: decoded.login as string };
    } catch {
        return null;
    }
}

export function requireAdminSession(req: Request, res: Response, next: NextFunction) {
    const token = extractAdminSessionToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Admin session required', code: 'UNAUTHORIZED' });
    }
    const session = verifyAdminSessionToken(token);
    if (!session) {
        return res.status(401).json({ error: 'Invalid or expired admin session', code: 'INVALID_SESSION' });
    }
    (req as Request & { adminSession?: AdminSessionPayload }).adminSession = session;
    return next();
}

export function extractAdminSessionToken(req: Request): string | null {
    const header = req.headers['x-admin-session'];
    if (typeof header === 'string' && header) return header;
    const auth = req.headers.authorization;
    if (auth?.startsWith('AdminBearer ')) return auth.slice(12);
    return null;
}
