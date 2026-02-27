import { NextRequest, NextResponse } from 'next/server';

interface RateLimitConfig {
    windowMs: number;  // Time window in milliseconds
    maxRequests: number;  // Max requests per window
}

// In-memory store for rate limiting (use Redis in production for multi-instance)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Clean up expired entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimitStore.entries()) {
        if (now > value.resetTime) {
            rateLimitStore.delete(key);
        }
    }
}, 60000); // Clean every minute

/**
 * Get client IP from request
 */
function getClientIp(request: NextRequest): string {
    const forwarded = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');

    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    if (realIp) {
        return realIp;
    }
    return 'unknown';
}

/**
 * Rate limiter function for API routes
 * @param request - NextRequest object
 * @param config - Rate limit configuration
 * @returns NextResponse if rate limited, null if allowed
 */
export function rateLimit(
    request: NextRequest,
    config: RateLimitConfig = { windowMs: 60000, maxRequests: 100 }
): NextResponse | null {
    const ip = getClientIp(request);
    const key = `${ip}:${request.nextUrl.pathname}`;
    const now = Date.now();

    const record = rateLimitStore.get(key);

    if (!record || now > record.resetTime) {
        // First request or window expired
        rateLimitStore.set(key, {
            count: 1,
            resetTime: now + config.windowMs,
        });
        return null; // Allowed
    }

    if (record.count >= config.maxRequests) {
        // Rate limit exceeded
        const retryAfter = Math.ceil((record.resetTime - now) / 1000);
        return NextResponse.json(
            {
                error: 'Too many requests',
                code: 'RATE_LIMITED',
                retryAfter
            },
            {
                status: 429,
                headers: {
                    'Retry-After': retryAfter.toString(),
                    'X-RateLimit-Limit': config.maxRequests.toString(),
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': new Date(record.resetTime).toISOString(),
                }
            }
        );
    }

    // Increment counter
    record.count++;
    rateLimitStore.set(key, record);
    return null; // Allowed
}

/**
 * Helper to apply rate limiting with custom config
 */
export function createRateLimiter(maxRequests: number, windowMs: number = 60000) {
    return (request: NextRequest) => rateLimit(request, { windowMs, maxRequests });
}

// Pre-configured rate limiters
export const standardLimit = (req: NextRequest) => rateLimit(req, { windowMs: 60000, maxRequests: 100 });
export const strictLimit = (req: NextRequest) => rateLimit(req, { windowMs: 60000, maxRequests: 20 });
export const authLimit = (req: NextRequest) => rateLimit(req, { windowMs: 60000, maxRequests: 10 });
