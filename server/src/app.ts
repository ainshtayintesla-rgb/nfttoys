import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';

// Load environment variables
dotenv.config();

// Import routes
import authRoutes from './routes/auth';
import qrRoutes from './routes/qr';
import nftRoutes from './routes/nft';
import walletRoutes from './routes/wallet';
import telegramRoutes from './routes/telegram';
import adminRoutes from './routes/admin';
import adminAuthRoutes from './routes/adminAuth';
import ownerRoutes from './routes/owner';
import notificationRoutes from './routes/notifications';
import referralRoutes from './routes/referrals';
import transactionRoutes from './routes/transactions';
import walletV2Routes from './routes/walletV2';

// Middleware
import { errorHandler } from './middleware/errorHandler';
import { getAllowedOrigins } from './middleware/csrfProtection';

const app = express();

// Disable X-Powered-By header
app.disable('x-powered-by');

// Trust first proxy hop (nginx) for correct rate-limit IP handling
app.set('trust proxy', 1);
// Security headers with Helmet
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false, // Allow embedding
    hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xContentTypeOptions: true, // X-Content-Type-Options: nosniff
    xFrameOptions: { action: 'deny' }, // X-Frame-Options: DENY
    xXssProtection: true, // X-XSS-Protection: 1; mode=block
}));

// Additional security headers
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    next();
});

// CORS Configuration — uses the same origin list as csrfProtection middleware
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (server-side proxy, mobile apps, curl)
        if (!origin) return callback(null, true);
        if (getAllowedOrigins().includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'], // Removed PUT - not used
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Telegram-Init-Data'],
    maxAge: 86400, // 24 hours
}));

// Block unsupported HTTP methods
app.use((req, res, next) => {
    const allowedMethods = ['GET', 'POST', 'DELETE', 'OPTIONS', 'HEAD'];
    if (!allowedMethods.includes(req.method)) {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    next();
});

// Parse JSON bodies with size limit
app.use(express.json({ limit: '10kb' }));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/auth', authRoutes);
app.use('/qr', qrRoutes);
app.use('/nft', nftRoutes);
app.use('/wallet', walletRoutes);
app.use('/telegram', telegramRoutes);
app.use('/admin', adminRoutes);
app.use('/admin/auth', adminAuthRoutes);
app.use('/owner', ownerRoutes);
app.use('/notifications', notificationRoutes);
app.use('/referrals', referralRoutes);
app.use('/transactions', transactionRoutes);
app.use('/v2', walletV2Routes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use(errorHandler);

export default app;
