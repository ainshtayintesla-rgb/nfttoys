import jwt, { SignOptions } from 'jsonwebtoken';

export interface WalletV2AccessPayload {
    sid: string;
    wid: string;
    did: string;
    platform: 'ios' | 'android' | 'web';
    uid?: string;
}

function requiredEnv(name: string): string {
    const value = process.env[name]?.trim();

    if (!value) {
        throw new Error(`${name} is not configured`);
    }

    return value;
}

export function walletV2AccessTokenTtlSec(): number {
    const rawValue = process.env.WALLET_V2_ACCESS_TOKEN_TTL_SEC;
    const parsed = Number.parseInt(rawValue || '3600', 10);

    if (!Number.isFinite(parsed) || parsed < 60) {
        return 3600;
    }

    return parsed;
}

function accessSecret(): string {
    return requiredEnv('WALLET_V2_ACCESS_TOKEN_SECRET');
}

export function signWalletV2AccessToken(payload: WalletV2AccessPayload): string {
    const options: SignOptions = {
        expiresIn: `${walletV2AccessTokenTtlSec()}s`,
    };

    return jwt.sign(payload, accessSecret(), options);
}

export function verifyWalletV2AccessToken(token: string): WalletV2AccessPayload | null {
    try {
        const decoded = jwt.verify(token, accessSecret());

        if (typeof decoded === 'string') {
            return null;
        }

        if (!decoded.sid || typeof decoded.sid !== 'string') {
            return null;
        }

        if (!decoded.wid || typeof decoded.wid !== 'string') {
            return null;
        }

        if (!decoded.did || typeof decoded.did !== 'string') {
            return null;
        }

        if (!decoded.platform || (decoded.platform !== 'ios' && decoded.platform !== 'android' && decoded.platform !== 'web')) {
            return null;
        }

        const payload: WalletV2AccessPayload = {
            sid: decoded.sid,
            wid: decoded.wid,
            did: decoded.did,
            platform: decoded.platform,
        };

        if (typeof decoded.uid === 'string' && decoded.uid.trim()) {
            payload.uid = decoded.uid;
        }

        return payload;
    } catch {
        return null;
    }
}
