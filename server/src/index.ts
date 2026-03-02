import app from './app';
import { startUpdateService } from './lib/updateService';

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
