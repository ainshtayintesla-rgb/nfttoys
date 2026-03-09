import crypto from 'crypto';

import { Prisma } from '@prisma/client';
import { Request } from 'express';

import { mnemonicFingerprint } from '../../../lib/walletV2/security';
import { prisma } from '../../../lib/db/prisma';
import {
    IMPORT_FINGERPRINT_LIMIT_PER_DAY,
    IMPORT_FINGERPRINT_WINDOW_MS,
} from '../constants';
import { DeviceInput } from '../types';

export function parseDeviceInput(rawDevice: unknown): DeviceInput | null {
    if (!rawDevice || typeof rawDevice !== 'object') {
        return null;
    }

    const candidate = rawDevice as {
        deviceId?: unknown;
        platform?: unknown;
        biometricSupported?: unknown;
        devicePubKey?: unknown;
    };

    const deviceId = typeof candidate.deviceId === 'string' ? candidate.deviceId.trim() : '';
    const platform = typeof candidate.platform === 'string' ? candidate.platform.trim().toLowerCase() : '';
    const biometricSupported = typeof candidate.biometricSupported === 'boolean'
        ? candidate.biometricSupported
        : false;
    const devicePubKey = typeof candidate.devicePubKey === 'string' && candidate.devicePubKey.trim()
        ? candidate.devicePubKey.trim()
        : null;

    if (!deviceId || deviceId.length > 128) {
        return null;
    }

    if (platform !== 'ios' && platform !== 'android' && platform !== 'web') {
        return null;
    }

    return {
        deviceId,
        platform: platform as DeviceInput['platform'],
        biometricSupported,
        devicePubKey,
    };
}

export async function checkFingerprintAttemptDb(fingerprint: string): Promise<{ allowed: boolean; retryAfterSec: number }> {
    const windowStart = new Date(Date.now() - IMPORT_FINGERPRINT_WINDOW_MS);

    const result = await prisma.$queryRaw<[{ count: bigint }]>(
        Prisma.sql`
            SELECT COUNT(*) AS count
            FROM audit_events_v2
            WHERE event = 'wallet.import.fingerprint_attempt'
              AND (meta->>'fingerprint') = ${fingerprint}
              AND created_at >= ${windowStart}
        `,
    );

    const count = Number(result[0]?.count ?? 0n);

    if (count >= IMPORT_FINGERPRINT_LIMIT_PER_DAY) {
        const oldestResult = await prisma.$queryRaw<[{ oldest_at: Date | null }]>(
            Prisma.sql`
                SELECT MIN(created_at) AS oldest_at
                FROM audit_events_v2
                WHERE event = 'wallet.import.fingerprint_attempt'
                  AND (meta->>'fingerprint') = ${fingerprint}
                  AND created_at >= ${windowStart}
            `,
        );
        const oldestAt = oldestResult[0]?.oldest_at;
        const retryAfterSec = oldestAt
            ? Math.max(1, Math.ceil((oldestAt.getTime() + IMPORT_FINGERPRINT_WINDOW_MS - Date.now()) / 1000))
            : Math.ceil(IMPORT_FINGERPRINT_WINDOW_MS / 1000);

        return { allowed: false, retryAfterSec };
    }

    return { allowed: true, retryAfterSec: 0 };
}

export async function recordFingerprintAttemptDb(fingerprint: string): Promise<void> {
    await prisma.auditEventV2.create({
        data: {
            id: crypto.randomUUID(),
            event: 'wallet.import.fingerprint_attempt',
            meta: { fingerprint },
        },
    });
}

// Use req.ip — Express resolves this correctly based on `trust proxy` setting,
// preventing spoofing via X-Forwarded-For injection.
export function ipFromRequest(req: Request): string | undefined {
    return req.ip || req.socket.remoteAddress || undefined;
}
