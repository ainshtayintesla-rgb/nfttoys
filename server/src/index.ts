import app from './app';
import { startUpdateService } from './lib/updateService';

const PORT = process.env.PORT || 4000;

async function bootstrap() {
    try {
        await startUpdateService();
    } catch (error) {
        console.error('Failed to initialize update service:', error);
    }

    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`📡 Health check: http://localhost:${PORT}/health`);
    });
}

void bootstrap();
