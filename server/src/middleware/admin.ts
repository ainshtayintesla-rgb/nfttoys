import fs from 'fs';
import path from 'path';
import { NextFunction, Request, Response } from 'express';

function parseAdminIds(raw: string): string[] {
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

let cachedEnvPath = '';
let cachedEnvMtimeMs = -1;
let cachedClientAdminIds: string[] = [];

function readAdminIdsFromClientEnv(): string[] {
    try {
        const envPath = path.resolve(process.cwd(), '../client/.env');
        const stats = fs.statSync(envPath);

        if (envPath === cachedEnvPath && stats.mtimeMs === cachedEnvMtimeMs) {
            return cachedClientAdminIds;
        }

        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/^NEXT_PUBLIC_ADMIN_IDS=(.+)$/m);
        const ids = parseAdminIds(match?.[1] || '');

        cachedEnvPath = envPath;
        cachedEnvMtimeMs = stats.mtimeMs;
        cachedClientAdminIds = ids;

        return ids;
    } catch {
        return [];
    }
}

export function getAdminTelegramIds(): string[] {
    const fromEnv = parseAdminIds(
        process.env.ADMIN_IDS || process.env.NEXT_PUBLIC_ADMIN_IDS || '',
    );

    if (fromEnv.length > 0) {
        return fromEnv;
    }

    return readAdminIdsFromClientEnv();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (!req.authUser) {
        return res.status(401).json({
            error: 'Authorization token is required',
            code: 'UNAUTHORIZED',
        });
    }

    const adminIds = getAdminTelegramIds();

    if (adminIds.length === 0) {
        return res.status(500).json({
            error: 'Admin IDs are not configured',
            code: 'ADMIN_CONFIG_ERROR',
        });
    }

    const telegramId = String(req.authUser.telegramId);
    if (!adminIds.includes(telegramId)) {
        return res.status(403).json({
            error: 'Admin access required',
            code: 'FORBIDDEN',
        });
    }

    return next();
}
