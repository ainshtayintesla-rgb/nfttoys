import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_v2_integration';
process.env.WALLET_V2_PEPPER = process.env.WALLET_V2_PEPPER || 'test_wallet_v2_pepper';
process.env.WALLET_V2_FINGERPRINT_PEPPER = process.env.WALLET_V2_FINGERPRINT_PEPPER || 'test_wallet_v2_fingerprint_pepper';
process.env.WALLET_V2_ACCESS_TOKEN_SECRET = process.env.WALLET_V2_ACCESS_TOKEN_SECRET || 'test_wallet_v2_access_secret';
process.env.WALLET_V2_REFRESH_TOKEN_SECRET = process.env.WALLET_V2_REFRESH_TOKEN_SECRET || 'test_wallet_v2_refresh_secret';
process.env.WALLET_V2_ACCESS_TOKEN_TTL_SEC = process.env.WALLET_V2_ACCESS_TOKEN_TTL_SEC || '3600';
process.env.WALLET_V2_REFRESH_TOKEN_TTL_SEC = process.env.WALLET_V2_REFRESH_TOKEN_TTL_SEC || '3600';
process.env.WALLET_V2_CHALLENGE_TTL_SEC = process.env.WALLET_V2_CHALLENGE_TTL_SEC || '300';

import request from 'supertest';

import app from '../src/app';
import { signAuthToken } from '../src/lib/auth/jwt';
import { prisma } from '../src/lib/db/prisma';

function authHeader(uid: string, telegramId: number): string {
    return `Bearer ${signAuthToken({ uid, telegramId })}`;
}

async function cleanupTestUsers(userIds: string[]) {
    await prisma.nftStakingV2.deleteMany({});
    await prisma.transaction.deleteMany({
        where: {
            tokenId: {
                startsWith: 'wv2-stake-',
            },
        },
    });
    await prisma.nftHistory.deleteMany({
        where: {
            tokenId: {
                startsWith: 'wv2-stake-',
            },
        },
    });
    await prisma.nft.deleteMany({
        where: {
            tokenId: {
                startsWith: 'wv2-stake-',
            },
        },
    });
    await prisma.txChallengeV2.deleteMany({});
    await prisma.txV2.deleteMany({});
    await prisma.walletSessionV2.deleteMany({});
    await prisma.balanceV2.deleteMany({});
    await prisma.addressV2.deleteMany({});
    await prisma.auditEventV2.deleteMany({});
    await prisma.walletV2.deleteMany({});

    if (userIds.length > 0) {
        await prisma.user.deleteMany({
            where: {
                id: { in: userIds },
            },
        });
    }
}

test('wallet v2 end-to-end flow: create/import/session/tx confirm', async () => {
    const baseId = Date.now();
    const user1Telegram = 910000000 + (baseId % 1000000);
    const user2Telegram = user1Telegram + 1;
    const user1Id = `telegram_${user1Telegram}`;
    const user2Id = `telegram_${user2Telegram}`;

    await cleanupTestUsers([user1Id, user2Id]);

    try {
        const user1LegacyAuth = authHeader(user1Id, user1Telegram);
        const user2LegacyAuth = authHeader(user2Id, user2Telegram);

        const createUser1 = await request(app)
            .post('/v2/wallet/create')
            .set('Authorization', user1LegacyAuth)
            .send({
                pin: '1234',
                device: {
                    deviceId: 'ios-device-user1',
                    platform: 'ios',
                    biometricSupported: true,
                    devicePubKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                },
            });

        assert.equal(createUser1.status, 201);
        assert.equal(createUser1.body.success, true);
        assert.equal(Array.isArray(createUser1.body.data.mnemonic), true);
        assert.equal(createUser1.body.data.mnemonic.length, 24);

        const user1WalletId = createUser1.body.data.wallet.id as string;
        const user1Address = createUser1.body.data.wallet.address as string;
        const user1Mnemonic = createUser1.body.data.mnemonic as string[];
        const user1RefreshToken = createUser1.body.data.session.refreshToken as string;

        const createUser2 = await request(app)
            .post('/v2/wallet/create')
            .set('Authorization', user2LegacyAuth)
            .send({
                pin: '4321',
                device: {
                    deviceId: 'android-device-user2',
                    platform: 'android',
                    biometricSupported: false,
                },
            });

        assert.equal(createUser2.status, 201);
        const user2WalletId = createUser2.body.data.wallet.id as string;
        const user2Address = createUser2.body.data.wallet.address as string;
        const user2AccessToken = createUser2.body.data.session.accessToken as string;

        const refresh = await request(app)
            .post('/v2/session/refresh')
            .send({
                refreshToken: user1RefreshToken,
                deviceId: 'ios-device-user1',
            });

        assert.equal(refresh.status, 200);
        assert.equal(refresh.body.success, true);
        const refreshedUser1AccessToken = refresh.body.data.session.accessToken as string;
        const refreshedUser1RefreshToken = refresh.body.data.session.refreshToken as string;

        const txCreate = await request(app)
            .post('/v2/tx/create')
            .set('Authorization', `Bearer ${refreshedUser1AccessToken}`)
            .send({
                walletId: user1WalletId,
                toAddress: user2Address,
                asset: 'UZS',
                amount: '0',
                idempotencyKey: `bad-${baseId}`,
                meta: {
                    comment: 'invalid test',
                },
            });

        assert.equal(txCreate.status, 400);

        await prisma.balanceV2.update({
            where: {
                walletId_asset: {
                    walletId: user1WalletId,
                    asset: 'UZS',
                },
            },
            data: {
                available: 100000n,
            },
        });

        const validTxCreate = await request(app)
            .post('/v2/tx/create')
            .set('Authorization', `Bearer ${refreshedUser1AccessToken}`)
            .send({
                walletId: user1WalletId,
                toAddress: user2Address,
                asset: 'UZS',
                amount: '25000',
                idempotencyKey: `idem-${baseId}`,
                meta: {
                    comment: 'gift',
                },
            });

        assert.equal(validTxCreate.status, 201);
        assert.equal(validTxCreate.body.success, true);
        const txId = validTxCreate.body.data.tx.id as string;
        const challengeId = validTxCreate.body.data.challenge.challengeId as string;

        const txConfirm = await request(app)
            .post('/v2/tx/confirm')
            .set('Authorization', `Bearer ${refreshedUser1AccessToken}`)
            .send({
                txId,
                challengeId,
                auth: {
                    method: 'pin',
                    pin: '1234',
                },
            });

        assert.equal(txConfirm.status, 200);
        assert.equal(txConfirm.body.success, true);
        assert.equal(txConfirm.body.data.tx.status, 'completed');

        const user1Balance = await request(app)
            .get(`/v2/wallet/${user1WalletId}/balance`)
            .set('Authorization', `Bearer ${refreshedUser1AccessToken}`);

        assert.equal(user1Balance.status, 200);
        assert.equal(user1Balance.body.success, true);

        const user2Balance = await request(app)
            .get(`/v2/wallet/${user2WalletId}/balance`)
            .set('Authorization', `Bearer ${user2AccessToken}`);

        assert.equal(user2Balance.status, 200);
        const uzsBalanceRow = (user2Balance.body.data.balances as Array<{ asset: string; available: string }>).find((row) => row.asset === 'UZS');
        assert.equal(uzsBalanceRow?.available, '25000');

        const stakingTokenId = `wv2-stake-${baseId}`;
        const stakingAnchorAt = new Date(Date.now() - 30 * 60 * 60 * 1000);
        await prisma.nft.create({
            data: {
                tokenId: stakingTokenId,
                contractAddress: `wv2-contract-${baseId}`,
                ownerId: user1Id,
                modelName: 'Stake Toy',
                serialNumber: String(baseId).slice(-6),
                rarity: 'common',
                tgsFile: 'stake-test.tgs',
                status: 'active',
                mintedAt: stakingAnchorAt,
                lastTransferAt: stakingAnchorAt,
            },
        });

        const stakingStateBefore = await request(app)
            .get(`/v2/wallet/${user1WalletId}/nft-staking/state`)
            .set('Authorization', `Bearer ${refreshedUser1AccessToken}`);

        assert.equal(stakingStateBefore.status, 200);
        const availableBeforeStake = stakingStateBefore.body.data.available as Array<{ tokenId: string }>;
        assert.equal(availableBeforeStake.some((row) => row.tokenId === stakingTokenId), true);

        const stakeNft = await request(app)
            .post(`/v2/wallet/${user1WalletId}/nft-staking/stake`)
            .set('Authorization', `Bearer ${refreshedUser1AccessToken}`)
            .send({
                tokenId: stakingTokenId,
            });

        assert.equal(stakeNft.status, 201);
        assert.equal(stakeNft.body.success, true);

        await prisma.nftStakingV2.update({
            where: {
                tokenId: stakingTokenId,
            },
            data: {
                stakedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
                lastClaimAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
            },
        });

        const claimNftReward = await request(app)
            .post(`/v2/wallet/${user1WalletId}/nft-staking/claim`)
            .set('Authorization', `Bearer ${refreshedUser1AccessToken}`)
            .send({
                tokenId: stakingTokenId,
            });

        assert.equal(claimNftReward.status, 200);
        assert.equal(claimNftReward.body.success, true);
        assert.equal(Number.parseInt(claimNftReward.body.data.claimedAmount as string, 10) > 0, true);

        const unstakeNft = await request(app)
            .post(`/v2/wallet/${user1WalletId}/nft-staking/unstake`)
            .set('Authorization', `Bearer ${refreshedUser1AccessToken}`)
            .send({
                tokenId: stakingTokenId,
                claimRewards: false,
            });

        assert.equal(unstakeNft.status, 200);
        assert.equal(unstakeNft.body.success, true);
        assert.equal(unstakeNft.body.data.position.status, 'unstaked');

        const importWallet = await request(app)
            .post('/v2/wallet/import')
            .set('Authorization', user1LegacyAuth)
            .send({
                mnemonic: user1Mnemonic,
                newPin: '5678',
                device: {
                    deviceId: 'web-device-user1-recovery',
                    platform: 'web',
                    biometricSupported: false,
                },
            });

        assert.equal(importWallet.status, 200);
        assert.equal(importWallet.body.success, true);
        assert.equal(importWallet.body.data.wallet.id, user1WalletId);
        assert.equal(importWallet.body.data.wallet.address, user1Address);

        const importedAccessToken = importWallet.body.data.session.accessToken as string;

        const sessions = await request(app)
            .get('/v2/sessions')
            .set('Authorization', `Bearer ${importedAccessToken}`);

        assert.equal(sessions.status, 200);
        assert.equal(sessions.body.success, true);

        const sessionRows = sessions.body.data.sessions as Array<{ id: string; deviceId: string; isCurrent: boolean }>;
        assert.ok(sessionRows.length >= 2);

        const oldDeviceSession = sessionRows.find((session) => session.deviceId === 'ios-device-user1');
        assert.ok(oldDeviceSession);

        const revoke = await request(app)
            .post('/v2/sessions/revoke')
            .set('Authorization', `Bearer ${importedAccessToken}`)
            .send({
                sessionId: oldDeviceSession?.id,
            });

        assert.equal(revoke.status, 200);
        assert.equal(revoke.body.success, true);

        const revokedSessionAccess = await request(app)
            .get(`/v2/wallet/${user1WalletId}/balance`)
            .set('Authorization', `Bearer ${refreshedUser1AccessToken}`);

        assert.equal(revokedSessionAccess.status, 423);

        const refreshRevoked = await request(app)
            .post('/v2/session/refresh')
            .send({
                refreshToken: refreshedUser1RefreshToken,
                deviceId: 'ios-device-user1',
            });

        assert.equal(refreshRevoked.status, 423);

        const importedRefreshToken = importWallet.body.data.session.refreshToken as string;

        const logout = await request(app)
            .post('/v2/session/logout')
            .set('Authorization', `Bearer ${importedAccessToken}`)
            .send({
                refreshToken: importedRefreshToken,
            });

        assert.equal(logout.status, 200);
        assert.equal(logout.body.success, true);
    } finally {
        await cleanupTestUsers([user1Id, user2Id]);
    }
});
