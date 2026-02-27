import crypto from 'crypto';

interface TelegramUser {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
}

interface ValidatedTelegramData {
    valid: boolean;
    user?: TelegramUser;
    auth_date?: number;
    query_id?: string;
    error?: string;
}

/**
 * Validates Telegram WebApp initData using HMAC-SHA256
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramInitData(initData: string): ValidatedTelegramData {
    const botToken = process.env.BOT_TOKEN;

    if (!botToken) {
        console.error('BOT_TOKEN environment variable is not set');
        return { valid: false, error: 'Server configuration error' };
    }

    if (!initData) {
        return { valid: false, error: 'No init data provided' };
    }

    try {
        // Parse the init data
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');

        if (!hash) {
            return { valid: false, error: 'No hash in init data' };
        }

        // Remove hash from params and sort alphabetically
        params.delete('hash');
        const dataCheckArray: string[] = [];

        params.forEach((value, key) => {
            dataCheckArray.push(`${key}=${value}`);
        });

        dataCheckArray.sort();
        const dataCheckString = dataCheckArray.join('\n');

        // Create secret key using HMAC-SHA256
        const secretKey = crypto
            .createHmac('sha256', 'WebAppData')
            .update(botToken)
            .digest();

        // Calculate expected hash
        const expectedHash = crypto
            .createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        // Timing-safe comparison
        if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash))) {
            return { valid: false, error: 'Invalid hash' };
        }

        // Check auth_date (should not be older than 24 hours)
        const authDate = parseInt(params.get('auth_date') || '0', 10);
        const now = Math.floor(Date.now() / 1000);
        const maxAge = 86400; // 24 hours

        if (now - authDate > maxAge) {
            return { valid: false, error: 'Init data expired' };
        }

        // Parse user data
        const userJson = params.get('user');
        let user: TelegramUser | undefined;

        if (userJson) {
            try {
                user = JSON.parse(userJson);
            } catch {
                return { valid: false, error: 'Invalid user data' };
            }
        }

        return {
            valid: true,
            user,
            auth_date: authDate,
            query_id: params.get('query_id') || undefined,
        };

    } catch (error) {
        console.error('Error validating Telegram init data:', error);
        return { valid: false, error: 'Validation error' };
    }
}
