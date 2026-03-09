const PROD_API_BASE_URL = 'https://api.nfttoys.shop';
const DEV_API_BASE_URL = 'http://localhost:4000';

function normalizeUrl(value: string): string {
    return value.trim().replace(/\/+$/, '');
}

export function resolveApiBaseUrl(): string {
    const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
    if (configured) {
        return normalizeUrl(configured);
    }

    return process.env.NODE_ENV === 'production' ? PROD_API_BASE_URL : DEV_API_BASE_URL;
}

export const API_BASE_URL = resolveApiBaseUrl();
