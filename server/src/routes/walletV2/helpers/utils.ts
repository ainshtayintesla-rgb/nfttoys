import { Prisma } from '@prisma/client';
import { Response } from 'express';

import { formatWalletV2AddressForNetwork } from '../../../lib/walletV2/security';
import {
    DEFAULT_COLLECTION_NAME,
    WALLET_V2_NETWORK,
    WALLET_V2_STAKING_REWARD_SOURCE_ADDRESS,
    WALLET_V2_TESTNET_FAUCET_ADDRESS,
} from '../constants';

export function now(): Date {
    return new Date();
}

export function toIsoDate(value: Date | null | undefined): string | null {
    return value ? value.toISOString() : null;
}

export function formatWalletAddress(value: string): string {
    return formatWalletV2AddressForNetwork(value, WALLET_V2_NETWORK);
}

export function classifyWalletV2Tx(params: {
    walletId: string;
    ownAddress: string;
    tx: {
        walletId: string;
        fromAddress: string;
        toAddress: string;
        meta: Prisma.JsonValue | null;
    };
}): { type: 'send' | 'receive' | 'topup' | 'staking_reward'; direction: 'in' | 'out' } {
    const { walletId, ownAddress, tx } = params;
    const meta = tx.meta;
    const metaSource = (
        meta
        && typeof meta === 'object'
        && !Array.isArray(meta)
        && typeof (meta as { source?: unknown }).source === 'string'
    )
        ? (meta as { source: string }).source.trim().toLowerCase()
        : '';

    if (
        metaSource === 'nft_staking_reward'
        || tx.fromAddress === WALLET_V2_STAKING_REWARD_SOURCE_ADDRESS
    ) {
        return { type: 'staking_reward', direction: 'in' };
    }

    if (
        metaSource === 'testnet_faucet'
        || tx.fromAddress === WALLET_V2_TESTNET_FAUCET_ADDRESS
    ) {
        return { type: 'topup', direction: 'in' };
    }

    if (tx.toAddress === ownAddress && (tx.walletId !== walletId || tx.fromAddress !== ownAddress)) {
        return { type: 'receive', direction: 'in' };
    }

    return { type: 'send', direction: 'out' };
}

export function addHours(date: Date, hours: number): Date {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function readCollectionName(metadata: Prisma.JsonValue | null | undefined): string {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return DEFAULT_COLLECTION_NAME;
    }

    const rawCollectionName = (metadata as Record<string, unknown>).collectionName;
    if (typeof rawCollectionName !== 'string') {
        return DEFAULT_COLLECTION_NAME;
    }

    const normalized = rawCollectionName.trim();
    return normalized || DEFAULT_COLLECTION_NAME;
}

export function sendError(
    res: Response,
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
) {
    return res.status(statusCode).json({
        success: false,
        error: {
            code,
            message,
        },
        ...(details || {}),
    });
}

export function escapeXml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
