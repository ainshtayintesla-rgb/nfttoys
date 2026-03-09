import jwt, { SignOptions } from 'jsonwebtoken';

export interface JwtAuthPayload {
    uid: string;
    telegramId: number;
    firstName?: string;
    lastName?: string;
    username?: string;
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

function getJwtSecret(): string {
    const secret = process.env.JWT_SECRET || process.env.TOKEN_SECRET || '';
    if (!secret) {
        throw new Error('JWT secret is not configured. Set JWT_SECRET or TOKEN_SECRET.');
    }

    return secret;
}

export function signAuthToken(payload: JwtAuthPayload): string {
    const options: SignOptions = {
        expiresIn: JWT_EXPIRES_IN as SignOptions['expiresIn'],
    };

    return jwt.sign(payload, getJwtSecret(), options);
}

export function verifyAuthToken(token: string): JwtAuthPayload | null {
    try {
        const decoded = jwt.verify(token, getJwtSecret());
        if (typeof decoded === 'string') return null;

        if (!decoded.uid || typeof decoded.uid !== 'string') {
            return null;
        }

        if (!decoded.telegramId || typeof decoded.telegramId !== 'number') {
            return null;
        }

        return {
            uid: decoded.uid,
            telegramId: decoded.telegramId,
            firstName: typeof decoded.firstName === 'string' ? decoded.firstName : undefined,
            lastName: typeof decoded.lastName === 'string' ? decoded.lastName : undefined,
            username: typeof decoded.username === 'string' ? decoded.username : undefined,
        };
    } catch {
        return null;
    }
}
