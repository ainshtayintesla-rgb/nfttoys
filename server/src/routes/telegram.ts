import { Router } from 'express';
import { validateTelegramInitData } from '../lib/utils/telegramValidation';
import { fetchBotMeta } from '../lib/utils/telegramBot';
import { standardLimit } from '../middleware/rateLimit';

const router = Router();

// POST /telegram/validate
router.post('/validate', async (req, res) => {
    try {
        const { initData } = req.body;

        if (!initData) {
            return res.status(400).json({ valid: false, error: 'initData is required' });
        }

        const result = validateTelegramInitData(initData);

        if (!result.valid) {
            return res.status(401).json({ valid: false, error: result.error });
        }

        res.json({
            valid: true,
            user: result.user,
            auth_date: result.auth_date,
        });

    } catch (error) {
        console.error('Telegram validation error:', error);
        res.status(500).json({ valid: false, error: 'Server error' });
    }
});

// GET /telegram/bot-info
router.get('/bot-info', standardLimit, async (req, res) => {
    try {
        const result = await fetchBotMeta();

        if (!result.ok || !result.data) {
            return res.status(502).json({
                error: result.error || 'Bot info is unavailable',
                code: 'BOT_INFO_UNAVAILABLE',
            });
        }

        return res.json({
            success: true,
            bot: result.data,
        });
    } catch (error) {
        console.error('Telegram bot-info error:', error);
        return res.status(500).json({
            error: 'Failed to load bot info',
            code: 'BOT_INFO_FETCH_ERROR',
        });
    }
});

export default router;
