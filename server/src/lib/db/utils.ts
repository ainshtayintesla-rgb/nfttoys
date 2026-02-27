export function parseTelegramId(userId: string): string | null {
    const match = /^(?:telegram|tg)_(\d+)$/.exec(userId);
    if (!match) return null;
    return match[1] || null;
}

export function normalizedUsername(username?: string | null): string | null {
    if (!username) return null;
    const trimmed = username.trim().replace(/^@+/, '');
    if (!trimmed) return null;
    return trimmed.toLowerCase();
}
