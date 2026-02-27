// Mock database for storing activation tokens// In production, this would be a real database (Redis, PostgreSQL, etc.)

export interface TokenRecord {
    toyId: string;
    used: boolean;
    createdAt: number;
    usedAt?: number;
    usedBy?: number; // User ID who activated
}

// In-memory store (resets on page refresh - for demo only)
const tokenStore = new Map<string, TokenRecord>();

export const TokenStore = {
    /**
     * Save a new token record
     */
    set(token: string, record: TokenRecord): void {
        tokenStore.set(token, record);
    },

    /**
     * Get a token record
     */
    get(token: string): TokenRecord | undefined {
        return tokenStore.get(token);
    },

    /**
     * Check if token exists
     */
    has(token: string): boolean {
        return tokenStore.has(token);
    },

    /**
     * Mark token as used
     */
    markUsed(token: string, userId?: number): boolean {
        const record = tokenStore.get(token);
        if (!record) return false;

        record.used = true;
        record.usedAt = Date.now();
        record.usedBy = userId;
        tokenStore.set(token, record);
        return true;
    },

    /**
     * Check if token is already used
     */
    isUsed(token: string): boolean {
        const record = tokenStore.get(token);
        return record?.used ?? false;
    },

    /**
     * Get all tokens (for debugging)
     */
    getAll(): Map<string, TokenRecord> {
        return new Map(tokenStore);
    },

    /**
     * Clear all tokens (for testing)
     */
    clear(): void {
        tokenStore.clear();
    }
};
