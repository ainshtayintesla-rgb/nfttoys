/**
 * Mnemonic encryption/decryption using Web Crypto API.
 * PIN → PBKDF2 → AES-256-GCM key → encrypt/decrypt mnemonic words.
 *
 * Storage format: { salt, iv, ciphertext } — all base64-encoded.
 * The PIN is never stored; it's only used transiently to derive the key.
 */

export interface EncryptedMnemonic {
    /** PBKDF2 salt (base64) */
    s: string;
    /** AES-GCM IV (base64) */
    v: string;
    /** Ciphertext (base64) */
    c: string;
}

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function toBase64(buf: ArrayBuffer | Uint8Array): string {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(pin),
        'PBKDF2',
        false,
        ['deriveKey'],
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt.buffer as ArrayBuffer,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

/** Encrypt mnemonic words with a PIN. */
export async function encryptMnemonic(words: string[], pin: string): Promise<EncryptedMnemonic> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKey(pin, salt);

    const encoder = new TextEncoder();
    const plaintext = encoder.encode(words.join(' '));

    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
        key,
        plaintext,
    );

    return {
        s: toBase64(salt),
        v: toBase64(iv),
        c: toBase64(ciphertext),
    };
}

/** Decrypt mnemonic words with a PIN. Returns null if PIN is wrong. */
export async function decryptMnemonic(encrypted: EncryptedMnemonic, pin: string): Promise<string[] | null> {
    try {
        const salt = fromBase64(encrypted.s);
        const iv = fromBase64(encrypted.v);
        const ciphertext = fromBase64(encrypted.c);
        const key = await deriveKey(pin, salt);

        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
            key,
            ciphertext.buffer as ArrayBuffer,
        );

        const decoder = new TextDecoder();
        const phrase = decoder.decode(plaintext);
        const words = phrase.split(' ');

        if (words.length !== 24 || words.some((w) => !/^[a-z]+$/.test(w))) {
            return null;
        }

        return words;
    } catch {
        // Wrong PIN → AES-GCM auth tag mismatch → DOMException
        return null;
    }
}

/** Check if a value looks like an encrypted mnemonic. */
export function isEncryptedMnemonic(value: unknown): value is EncryptedMnemonic {
    if (!value || typeof value !== 'object') return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.s === 'string' && typeof obj.v === 'string' && typeof obj.c === 'string';
}
