import { Prisma } from '@prisma/client';

export type DevicePlatform = 'ios' | 'android' | 'web';

export type DeviceInput = {
    deviceId: string;
    platform: DevicePlatform;
    biometricSupported: boolean;
    devicePubKey: string | null;
};

export type WalletV2PinRecord = {
    walletId: string;
    pinHash: string;
    pinSalt: string;
};

export type WalletV2PinLookupClient = {
    walletV2: Prisma.TransactionClient['walletV2'];
};

export type WalletNftOwnershipContext = {
    userId: string | null;
    mainAddress: string;
};

export type NftStakingWindow = {
    opensAt: Date;
    closesAt: Date;
    canStake: boolean;
    reason: 'open' | 'not_open' | 'closed';
};

export class ApiError extends Error {
    public readonly statusCode: number;

    public readonly code: string;

    public readonly details?: Record<string, unknown>;

    constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}
