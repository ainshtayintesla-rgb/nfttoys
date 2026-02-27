import { Router } from 'express';

import {
    WriteAccessStatus,
    fetchNotificationPreferences,
    updateNotificationPreferences,
    updateWriteAccessStatus,
} from '../lib/utils/telegramBot';
import { requireAuth } from '../middleware/auth';
import { standardLimit } from '../middleware/rateLimit';

const router = Router();
const WRITE_ACCESS_STATUSES = new Set<WriteAccessStatus>(['unknown', 'allowed', 'denied', 'blocked']);

function mapBotServiceErrorStatus(status: number): number {
    if (status === 409) {
        return 409;
    }

    return 502;
}

// GET /notifications/preferences
router.get('/preferences', standardLimit, requireAuth, async (req, res) => {
    try {
        const telegramId = String(req.authUser!.telegramId);
        const result = await fetchNotificationPreferences(telegramId);

        if (!result.ok || !result.data) {
            return res.status(mapBotServiceErrorStatus(result.status)).json({
                error: result.error || 'Notification service unavailable',
                code: 'NOTIFICATION_SERVICE_UNAVAILABLE',
            });
        }

        return res.json({
            success: true,
            preferences: result.data,
        });
    } catch (error) {
        console.error('Failed to get notification preferences:', error);
        return res.status(500).json({
            error: 'Failed to get notification preferences',
            code: 'NOTIFICATIONS_FETCH_ERROR',
        });
    }
});

// POST /notifications/preferences
router.post('/preferences', standardLimit, requireAuth, async (req, res) => {
    try {
        const notificationsEnabled = req.body?.notificationsEnabled;
        const nftReceivedEnabled = req.body?.nftReceivedEnabled;

        if (notificationsEnabled !== undefined && typeof notificationsEnabled !== 'boolean') {
            return res.status(400).json({
                error: 'notificationsEnabled must be boolean',
                code: 'VALIDATION_ERROR',
            });
        }

        if (nftReceivedEnabled !== undefined && typeof nftReceivedEnabled !== 'boolean') {
            return res.status(400).json({
                error: 'nftReceivedEnabled must be boolean',
                code: 'VALIDATION_ERROR',
            });
        }

        const telegramId = String(req.authUser!.telegramId);

        const result = await updateNotificationPreferences({
            telegramId,
            notificationsEnabled,
            nftReceivedEnabled,
        });

        if (!result.ok || !result.data) {
            return res.status(mapBotServiceErrorStatus(result.status)).json({
                error: result.error || 'Notification update failed',
                code: result.status === 409 ? 'WRITE_ACCESS_REQUIRED' : 'NOTIFICATIONS_UPDATE_ERROR',
            });
        }

        return res.json({
            success: true,
            preferences: result.data,
        });
    } catch (error) {
        console.error('Failed to update notification preferences:', error);
        return res.status(500).json({
            error: 'Failed to update notification preferences',
            code: 'NOTIFICATIONS_UPDATE_ERROR',
        });
    }
});

// POST /notifications/write-access
router.post('/write-access', standardLimit, requireAuth, async (req, res) => {
    try {
        const statusRaw = req.body?.status;
        const botStartedRaw = req.body?.botStarted;

        if (typeof statusRaw !== 'string') {
            return res.status(400).json({
                error: 'status is required',
                code: 'VALIDATION_ERROR',
            });
        }

        const normalizedStatus = statusRaw.trim().toLowerCase() as WriteAccessStatus;
        if (!WRITE_ACCESS_STATUSES.has(normalizedStatus)) {
            return res.status(400).json({
                error: 'Invalid write-access status',
                code: 'VALIDATION_ERROR',
            });
        }

        if (botStartedRaw !== undefined && typeof botStartedRaw !== 'boolean') {
            return res.status(400).json({
                error: 'botStarted must be boolean',
                code: 'VALIDATION_ERROR',
            });
        }

        const telegramId = String(req.authUser!.telegramId);
        const result = await updateWriteAccessStatus({
            telegramId,
            status: normalizedStatus,
            botStarted: botStartedRaw,
        });

        if (!result.ok || !result.data) {
            return res.status(mapBotServiceErrorStatus(result.status)).json({
                error: result.error || 'Write access sync failed',
                code: 'WRITE_ACCESS_SYNC_ERROR',
            });
        }

        return res.json({
            success: true,
            preferences: result.data,
        });
    } catch (error) {
        console.error('Failed to sync write access:', error);
        return res.status(500).json({
            error: 'Failed to sync write access',
            code: 'WRITE_ACCESS_SYNC_ERROR',
        });
    }
});

export default router;
