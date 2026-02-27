/**
 * Input Validation Utilities
 * Helpers for sanitizing and validating user input
 */

/**
 * Sanitize string input - remove potentially dangerous characters
 */
export function sanitizeString(input: string): string {
    if (typeof input !== 'string') return '';

    return input
        .trim()
        .replace(/[<>]/g, '') // Remove HTML brackets
        .replace(/javascript:/gi, '') // Remove javascript: protocol
        .replace(/on\w+=/gi, ''); // Remove event handlers
}

/**
 * Validate required fields
 */
export function validateRequired(
    data: Record<string, any>,
    requiredFields: string[]
): { valid: boolean; missing: string[] } {
    const missing: string[] = [];

    for (const field of requiredFields) {
        const value = data[field];
        if (value === undefined || value === null || value === '') {
            missing.push(field);
        }
    }

    return {
        valid: missing.length === 0,
        missing,
    };
}

/**
 * Validate string length
 */
export function validateLength(
    value: string,
    min: number,
    max: number
): boolean {
    if (typeof value !== 'string') return false;
    return value.length >= min && value.length <= max;
}

/**
 * Validate numeric value
 */
export function validateNumber(
    value: any,
    min?: number,
    max?: number
): boolean {
    const num = Number(value);
    if (isNaN(num)) return false;
    if (min !== undefined && num < min) return false;
    if (max !== undefined && num > max) return false;
    return true;
}

/**
 * Validate enum value
 */
export function validateEnum<T extends string>(
    value: any,
    allowedValues: T[]
): value is T {
    return allowedValues.includes(value);
}

/**
 * Create validation error response
 */
export function validationError(message: string, fields?: string[]) {
    return {
        error: message,
        code: 'VALIDATION_ERROR',
        fields,
    };
}

/**
 * Sanitize object values
 */
export function sanitizeObject<T extends Record<string, any>>(obj: T): T {
    const sanitized = { ...obj } as Record<string, any>;

    for (const key of Object.keys(sanitized)) {
        if (typeof sanitized[key] === 'string') {
            sanitized[key] = sanitizeString(sanitized[key]);
        }
    }

    return sanitized as T;
}
