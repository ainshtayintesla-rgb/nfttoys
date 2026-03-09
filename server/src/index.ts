import app from './app';
import { startUpdateService } from './lib/updateService';

// ── Env validation ────────────────────────────────────────────────────────────
// Fail immediately before the server binds any port so k8s readiness probe
// never passes on a misconfigured pod — better a clear crash than silent bugs.
const REQUIRED_ENV: string[] = [
    'TOKEN_SECRET',
    'JWT_SECRET',
    'DATABASE_URL',
    'TELEGRAM_BOT_TOKEN',
    'ALLOWED_ORIGINS',
    'WALLET_V2_ACCESS_TOKEN_SECRET',
    'WALLET_V2_REFRESH_TOKEN_SECRET',
    'WALLET_V2_PEPPER',
];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingEnv.join(', ')}`);
    process.exit(1);
}
// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4000;
const UPDATE_SERVICE_ENABLED = String(process.env.UPDATE_SERVICE_ENABLED || 'true').toLowerCase() !== 'false';

async function bootstrap() {
    if (UPDATE_SERVICE_ENABLED) {
        try {
            await startUpdateService();
        } catch (error) {
            console.error('Failed to initialize update service:', error);
        }
    } else {
        console.log('Update service disabled by UPDATE_SERVICE_ENABLED=false');
    }

    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`📡 Health check: http://localhost:${PORT}/health`);
    });
}

void bootstrap();
