import { Router } from 'express';
import crypto from 'crypto';

import { prisma } from '../lib/db/prisma';
import { normalizedUsername } from '../lib/db/utils';
import { PEPE_MODELS } from '../lib/data/pepe_models';
import { generateTokenId, generateContractAddress, signTransaction, generateTxHash } from '../lib/utils/crypto';
import { sanitizeString, validateRequired, validateNumber } from '../lib/utils/validation';
import { requireAuth } from '../middleware/auth';
import { strictLimit } from '../middleware/rateLimit';
import { csrfProtection } from '../middleware/csrfProtection';

const router = Router();

const TOKEN_SECRET = process.env.TOKEN_SECRET || '';
if (!TOKEN_SECRET) {
    throw new Error('TOKEN_SECRET environment variable is required but not set. Server cannot start without it.');
}
const DEFAULT_COLLECTION_NAME = 'Plush pepe';

function verifyToken(token: string): { valid: boolean; nfcId?: string } {

    const newFormatResult = verifyTokenNewFormat(token);
    if (newFormatResult.valid) return newFormatResult;

    return verifyTokenLegacyFormat(token);
}

function verifyTokenNewFormat(token: string): { valid: boolean; nfcId?: string } {
    try {
        const parts = token.split('_');
        if (parts.length < 4) return { valid: false };

        const signature = parts.pop()!;
        const salt = parts.pop()!;
        const timestamp = parts.pop()!;
        const nfcIdB64 = parts.join('_');

        const nfcId = Buffer.from(nfcIdB64, 'base64url').toString('utf-8');

        const expectedSignature = crypto
            .createHmac('sha256', TOKEN_SECRET)
            .update(`${nfcId}:${timestamp}:${salt}`)
            .digest('hex')
            .substring(0, 32);

        if (signature.length !== expectedSignature.length) return { valid: false };

        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
            return { valid: false };
        }

        return { valid: true, nfcId };
    } catch {
        return { valid: false };
    }
}

function verifyTokenLegacyFormat(token: string): { valid: boolean; nfcId?: string } {
    try {
        const parts = token.split('.');
        if (parts.length !== 4) return { valid: false };

        const [nfcIdB64, timestamp, salt, signature] = parts;
        const nfcId = Buffer.from(nfcIdB64, 'base64').toString('utf-8');

        const expectedSignature = crypto
            .createHmac('sha256', TOKEN_SECRET)
            .update(`${nfcId}:${timestamp}:${salt}`)
            .digest('hex')
            .substring(0, 32);

        if (signature.length !== expectedSignature.length) return { valid: false };

        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
            return { valid: false };
        }

        return { valid: true, nfcId };
    } catch {
        return { valid: false };
    }
}

function generateSecureToken(nfcId: string): string {
    const secret = TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
    const salt = crypto.randomBytes(8).toString('hex');
    const timestamp = Date.now().toString(36);

    const signature = crypto
        .createHmac('sha256', secret)
        .update(`${nfcId}:${timestamp}:${salt}`)
        .digest('hex');

    const nfcIdEncoded = Buffer.from(nfcId).toString('base64url');
    return `${nfcIdEncoded}_${timestamp}_${salt}_${signature.substring(0, 32)}`;
}

function buildNfcId(modelName: string, serialNumber: number | string): string {
    return `nfc_${modelName.toLowerCase().replace(/\s/g, '_')}_${serialNumber}`;
}

// GET /qr/activate - Check QR status
router.get('/activate', async (req, res) => {
    try {
        const token = req.query.token as string;

        if (!token) {
            return res.status(400).json({ error: 'Token is required' });
        }

        const verification = verifyToken(token);
        if (!verification.valid || !verification.nfcId) {
            return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
        }

        const nfcId = verification.nfcId;
        const qr = await prisma.qrCode.findUnique({ where: { nfcId } });

        if (!qr) {
            const parts = nfcId.replace('nfc_', '').split('_');
            const serialNum = parts.pop() || '1';
            const nameSlug = parts.join('_');

            const model = PEPE_MODELS.find((m) =>
                m.name.toLowerCase().replace(/\s/g, '_') === nameSlug,
            );

            if (model) {
                return res.json({
                    status: 'available',
                    toy: {
                        id: nfcId,
                        name: model.name,
                        serialNumber: serialNum,
                        rarity: model.rarity,
                        tgsUrl: `/models/${model.tgsFile}`,
                    },
                });
            }

            return res.status(404).json({ error: 'QR code not found', code: 'NOT_FOUND' });
        }

        return res.json({
            status: qr.status,
            toy: {
                id: qr.nfcId,
                name: qr.modelName,
                serialNumber: qr.serialNumber,
                rarity: qr.rarity,
                tgsUrl: `/models/${qr.tgsFile}`,
            },
            usedAt: qr.usedAt ? qr.usedAt.toISOString() : null,
            usedBy: qr.usedBy,
            usedByName: qr.usedByName || null,
            usedByPhoto: qr.usedByPhoto || null,
            usedByFirstName: qr.usedByFirstName || null,
        });
    } catch (error) {
        console.error('Error checking QR:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /qr/activate - Activate QR and mint NFT
router.post('/activate', requireAuth, async (req, res) => {
    try {
        const { token, userId: requestedUserId, username, userPhoto, firstName } = req.body;
        const userId = req.authUser!.uid;

        if (!token) {
            return res.status(400).json({ error: 'Token is required' });
        }

        if (requestedUserId && requestedUserId !== userId) {
            return res.status(403).json({ error: 'userId does not match token user', code: 'UNAUTHORIZED' });
        }

        const verification = verifyToken(token);
        if (!verification.valid || !verification.nfcId) {
            return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
        }

        const nfcId = verification.nfcId;
        const qr = await prisma.qrCode.findUnique({ where: { nfcId } });

        if (!qr) {
            return res.status(404).json({ error: 'QR code not found', code: 'NOT_FOUND' });
        }

        if (qr.status === 'used') {
            return res.status(409).json({
                error: 'QR code already used',
                code: 'ALREADY_USED',
                usedAt: qr.usedAt ? qr.usedAt.toISOString() : null,
                usedBy: qr.usedBy,
                usedByName: qr.usedByName || null,
                usedByPhoto: qr.usedByPhoto || null,
                usedByFirstName: qr.usedByFirstName || null,
            });
        }

        let user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            const now = new Date();
            const usernameFromAuth = req.authUser?.username || null;
            user = await prisma.user.create({
                data: {
                    id: userId,
                    telegramId: String(req.authUser!.telegramId),
                    firstName: req.authUser?.firstName || null,
                    lastName: req.authUser?.lastName || null,
                    username: usernameFromAuth,
                    usernameLower: normalizedUsername(usernameFromAuth),
                    createdAt: now,
                    lastLoginAt: now,
                },
            });
        }
        const userWallet = user?.walletAddress || null;
        const effectiveUsername = username || user?.username || req.authUser?.username || null;
        const effectiveFirstName = firstName || user?.firstName || req.authUser?.firstName || null;
        const effectivePhoto = userPhoto || user?.photoUrl || null;

        const tokenId = generateTokenId(qr.modelName, Number.parseInt(qr.serialNumber, 10) || 0);
        const contractAddress = generateContractAddress(tokenId);
        const mintTimestamp = Date.now();

        const txData = {
            type: 'mint' as const,
            from: null,
            to: userWallet || 'anonymous',
            tokenId,
            timestamp: mintTimestamp,
        };
        const txSignature = signTransaction(txData, TOKEN_SECRET);
        const txHash = generateTxHash('mint', null, userWallet || 'anonymous', tokenId, mintTimestamp);

        await prisma.$transaction(async (tx) => {
            await tx.qrCode.update({
                where: { nfcId },
                data: {
                    status: 'used',
                    usedAt: new Date(),
                    usedBy: userId,
                    usedByName: effectiveUsername,
                    usedByPhoto: effectivePhoto,
                    usedByFirstName: effectiveFirstName,
                },
            });

            await tx.nft.create({
                data: {
                    tokenId,
                    contractAddress,
                    ownerWallet: userWallet,
                    ownerId: userId,
                    modelName: qr.modelName,
                    serialNumber: qr.serialNumber,
                    rarity: qr.rarity,
                    tgsFile: qr.tgsFile,
                    qrCodeId: nfcId,
                    mintedAt: new Date(),
                    status: 'minted',
                    metadata: {
                        collectionName: DEFAULT_COLLECTION_NAME,
                        name: `${qr.modelName} #${qr.serialNumber}`,
                        description: `NFT Toy - ${qr.modelName} (${qr.rarity})`,
                        image: `/models/${qr.tgsFile}`,
                    },
                },
            });

            await tx.nftHistory.create({
                data: {
                    tokenId,
                    wallet: userWallet,
                    userId,
                    type: 'mint',
                    timestamp: new Date(),
                },
            });

            await tx.transaction.create({
                data: {
                    txHash,
                    type: 'mint',
                    from: null,
                    to: userWallet,
                    toUserId: userId,
                    tokenId,
                    modelName: qr.modelName,
                    serialNumber: qr.serialNumber,
                    signature: txSignature,
                    timestamp: new Date(),
                    status: 'confirmed',
                },
            });
        });

        return res.json({
            success: true,
            toy: {
                id: nfcId,
                name: qr.modelName,
                serialNumber: qr.serialNumber,
                rarity: qr.rarity,
                tgsFile: qr.tgsFile,
                tgsUrl: `/models/${qr.tgsFile}`,
            },
            nft: {
                tokenId,
                contractAddress,
                ownerWallet: userWallet,
                txHash,
            },
            activatedAt: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Error activating QR:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /qr/create - Create new QR code
router.post('/create', strictLimit, async (req, res) => {
    try {
        const modelName = sanitizeString(req.body.modelName || '');
        const serialNumber = req.body.serialNumber;

        const validation = validateRequired({ modelName, serialNumber }, ['modelName', 'serialNumber']);
        if (!validation.valid) {
            return res.status(400).json({
                error: 'Model name and serial number are required',
                code: 'VALIDATION_ERROR',
                fields: validation.missing,
            });
        }

        if (!validateNumber(serialNumber, 1, 999999)) {
            return res.status(400).json({
                error: 'Serial number must be between 1 and 999999',
                code: 'VALIDATION_ERROR',
            });
        }

        const model = PEPE_MODELS.find((m) => m.name === modelName);
        if (!model) {
            return res.status(404).json({ error: 'Model not found' });
        }

        const serialAsString = String(serialNumber);

        const existingBySerial = await prisma.qrCode.findUnique({
            where: { serialNumber: serialAsString },
        });

        if (existingBySerial) {
            return res.status(409).json({
                error: `Serial number ${serialNumber} already exists for model "${existingBySerial.modelName}"`,
                code: 'SERIAL_EXISTS',
                existingModel: existingBySerial.modelName,
            });
        }

        const nfcId = buildNfcId(modelName, serialNumber);
        const existingNfc = await prisma.qrCode.findUnique({ where: { nfcId } });

        if (existingNfc) {
            return res.status(409).json({ error: 'QR code already exists', code: 'DUPLICATE' });
        }

        const token = generateSecureToken(nfcId);

        await prisma.qrCode.create({
            data: {
                nfcId,
                modelName,
                serialNumber: serialAsString,
                rarity: model.rarity,
                tgsFile: model.tgsFile,
                token,
                status: 'created',
                createdAt: new Date(),
            },
        });

        return res.json({
            success: true,
            nfcId,
            activationUrl: `/activate/${encodeURIComponent(token)}`,
            qrData: {
                modelName,
                serialNumber,
                rarity: model.rarity,
            },
        });
    } catch (error) {
        console.error('Error creating QR:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /qr/create-batch - Create multiple QR codes in one request
router.post('/create-batch', strictLimit, async (req, res) => {
    try {
        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];

        if (rawItems.length === 0) {
            return res.status(400).json({
                error: 'At least one item is required',
                code: 'VALIDATION_ERROR',
            });
        }

        if (rawItems.length > 500) {
            return res.status(400).json({
                error: 'Batch size must be 500 items or less',
                code: 'VALIDATION_ERROR',
            });
        }

        const preparedItems: Array<{
            modelName: string;
            serialNumber: number;
            serialAsString: string;
            rarity: string;
            tgsFile: string;
            nfcId: string;
            token: string;
        }> = [];

        const seenSerials = new Set<string>();
        const seenNfcIds = new Set<string>();

        for (const rawItem of rawItems) {
            const modelName = sanitizeString(String(rawItem?.modelName || ''));
            const serialNumber = Number(rawItem?.serialNumber);

            if (!modelName || !validateNumber(serialNumber, 1, 999999)) {
                return res.status(400).json({
                    error: 'Each item must include valid modelName and serialNumber',
                    code: 'VALIDATION_ERROR',
                });
            }

            const model = PEPE_MODELS.find((m) => m.name === modelName);
            if (!model) {
                return res.status(404).json({
                    error: `Model not found: ${modelName}`,
                    code: 'MODEL_NOT_FOUND',
                });
            }

            const serialAsString = String(serialNumber);
            if (seenSerials.has(serialAsString)) {
                return res.status(409).json({
                    error: `Serial number ${serialNumber} is duplicated inside batch`,
                    code: 'SERIAL_DUPLICATE_IN_BATCH',
                });
            }

            const nfcId = buildNfcId(modelName, serialNumber);
            if (seenNfcIds.has(nfcId)) {
                return res.status(409).json({
                    error: `Duplicate NFC ID in batch: ${nfcId}`,
                    code: 'DUPLICATE_IN_BATCH',
                });
            }

            seenSerials.add(serialAsString);
            seenNfcIds.add(nfcId);
            preparedItems.push({
                modelName,
                serialNumber,
                serialAsString,
                rarity: model.rarity,
                tgsFile: model.tgsFile,
                nfcId,
                token: generateSecureToken(nfcId),
            });
        }

        const serialsToCheck = preparedItems.map((item) => item.serialAsString);
        const existingBySerial = await prisma.qrCode.findMany({
            where: {
                serialNumber: {
                    in: serialsToCheck,
                },
            },
            select: {
                serialNumber: true,
                modelName: true,
            },
        });

        if (existingBySerial.length > 0) {
            const existing = existingBySerial[0];
            return res.status(409).json({
                error: `Serial number ${existing.serialNumber} already exists for model "${existing.modelName}"`,
                code: 'SERIAL_EXISTS',
                existingModel: existing.modelName,
                existingSerialNumber: existing.serialNumber,
            });
        }

        const nfcIdsToCheck = preparedItems.map((item) => item.nfcId);
        const existingNfc = await prisma.qrCode.findMany({
            where: {
                nfcId: {
                    in: nfcIdsToCheck,
                },
            },
            select: {
                nfcId: true,
            },
        });

        if (existingNfc.length > 0) {
            return res.status(409).json({
                error: `QR code already exists: ${existingNfc[0].nfcId}`,
                code: 'DUPLICATE',
                nfcId: existingNfc[0].nfcId,
            });
        }

        await prisma.qrCode.createMany({
            data: preparedItems.map((item) => ({
                nfcId: item.nfcId,
                modelName: item.modelName,
                serialNumber: item.serialAsString,
                rarity: item.rarity,
                tgsFile: item.tgsFile,
                token: item.token,
                status: 'created',
                createdAt: new Date(),
            })),
        });

        return res.json({
            success: true,
            created: preparedItems.length,
            qrCodes: preparedItems.map((item) => ({
                nfcId: item.nfcId,
                modelName: item.modelName,
                serialNumber: item.serialNumber,
                rarity: item.rarity,
                activationUrl: `/activate/${encodeURIComponent(item.token)}`,
            })),
        });
    } catch (error) {
        console.error('Error creating QR batch:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /qr/delete - Delete QR code
router.delete('/delete', csrfProtection, async (req, res) => {
    try {
        const nfcId = req.query.nfcId as string;

        if (!nfcId) {
            return res.status(400).json({ error: 'nfcId is required' });
        }

        const qr = await prisma.qrCode.findUnique({ where: { nfcId } });

        if (!qr) {
            return res.status(404).json({ error: 'QR code not found', code: 'NOT_FOUND' });
        }

        await prisma.qrCode.delete({ where: { nfcId } });

        return res.json({ success: true, message: `QR code ${nfcId} deleted` });
    } catch (error) {
        console.error('Error deleting QR:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /qr/list - List all QR codes
router.get('/list', async (req, res) => {
    try {
        const rows = await prisma.qrCode.findMany({
            orderBy: {
                createdAt: 'desc',
            },
        });

        const qrCodes = rows.map((row) => ({
            id: row.nfcId,
            nfcId: row.nfcId,
            modelName: row.modelName,
            serialNumber: row.serialNumber,
            rarity: row.rarity,
            status: row.status,
            token: row.token,
            createdAt: row.createdAt ? row.createdAt.toISOString() : null,
            usedAt: row.usedAt ? row.usedAt.toISOString() : null,
            usedBy: row.usedBy,
        }));

        let used = 0;
        let created = 0;

        qrCodes.forEach((qr) => {
            if (qr.status === 'used') used += 1;
            else created += 1;
        });

        return res.json({
            qrCodes,
            stats: { total: qrCodes.length, used, created },
        });
    } catch (error) {
        console.error('Error getting QR list:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
