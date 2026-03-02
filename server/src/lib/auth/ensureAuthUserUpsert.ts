import { Prisma } from '@prisma/client';

import { prisma } from '../db/prisma';
import { normalizedUsername } from '../db/utils';
import { JwtAuthPayload } from './jwt';

function normalizeOptionalField(value?: string): string | null | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed || null;
}

function isUsernameUniqueConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        return false;
    }

    const target = error.meta?.target;
    if (!Array.isArray(target)) {
        return false;
    }

    return target.includes('usernameLower');
}

export async function ensureAuthUserUpsert(payload: JwtAuthPayload): Promise<void> {
    const now = new Date();
    const telegramId = String(payload.telegramId);

    const firstName = normalizeOptionalField(payload.firstName) ?? null;
    const lastName = normalizeOptionalField(payload.lastName) ?? null;
    const username = normalizeOptionalField(payload.username) ?? null;

    const updateData: Prisma.UserUpdateInput = {
        telegramId,
        lastLoginAt: now,
    };

    const firstNameUpdate = normalizeOptionalField(payload.firstName);
    if (firstNameUpdate !== undefined) {
        updateData.firstName = firstNameUpdate;
    }

    const lastNameUpdate = normalizeOptionalField(payload.lastName);
    if (lastNameUpdate !== undefined) {
        updateData.lastName = lastNameUpdate;
    }

    const usernameUpdate = normalizeOptionalField(payload.username);
    if (usernameUpdate !== undefined) {
        updateData.username = usernameUpdate;
        updateData.usernameLower = normalizedUsername(usernameUpdate);
    }

    const baseCreateData: Prisma.UserCreateInput = {
        id: payload.uid,
        telegramId,
        firstName,
        lastName,
        username,
        usernameLower: normalizedUsername(username),
        createdAt: now,
        lastLoginAt: now,
    };

    try {
        await prisma.user.upsert({
            where: { id: payload.uid },
            create: baseCreateData,
            update: updateData,
        });
    } catch (error) {
        if (!isUsernameUniqueConflict(error)) {
            throw error;
        }

        const fallbackUpdate: Prisma.UserUpdateInput = {
            telegramId,
            lastLoginAt: now,
        };

        if (firstNameUpdate !== undefined) {
            fallbackUpdate.firstName = firstNameUpdate;
        }

        if (lastNameUpdate !== undefined) {
            fallbackUpdate.lastName = lastNameUpdate;
        }

        await prisma.user.upsert({
            where: { id: payload.uid },
            create: {
                ...baseCreateData,
                username: null,
                usernameLower: null,
            },
            update: fallbackUpdate,
        });
    }
}
