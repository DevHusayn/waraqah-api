import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import mongoSanitize from 'express-mongo-sanitize';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth.js';
import invoiceRoutes from './routes/invoices.js';
import quotationRoutes from './routes/quotations.js';
import draftRoutes from './routes/drafts.js';
import clientRoutes from './routes/clients.js';
import businessInfoRoutes from './routes/companyInfo.js';
import productRoutes from './routes/products.js';
import paymentRoutes, { paystackWebhookHandler } from './routes/payments.js';
import publicRoutes from './routes/publicInvoices.js';
import cronRoutes from './routes/cron.js';
import { buildCorsOptions } from './utils/corsConfig.js';
import { assertEnvOrExit } from './utils/envValidation.js';
import { globalApiLimiter, webhookLimiter } from './middleware/rateLimits.js';
import csrfProtection from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

dotenv.config();
assertEnvOrExit();

const app = express();
app.set('trust proxy', 1);

app.use(cors(buildCorsOptions()));
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));
app.use(hpp());

app.post(
    '/api/payments/webhook',
    webhookLimiter,
    express.raw({ type: 'application/json' }),
    paystackWebhookHandler
);

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(mongoSanitize());

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/waraqah';

let dbReady = false;

async function connectDB() {
    if (mongoose.connection.readyState === 1) {
        dbReady = true;
        return;
    }
    if (mongoose.connection.readyState === 2) {
        await mongoose.connection.asPromise();
        dbReady = true;
        return;
    }
    await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 8000,
        socketTimeoutMS: 45000,
    });
    dbReady = true;
    console.log('MongoDB connected');
}

app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    });
});

app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        console.error('MongoDB connection error:', err);
        res.status(503).json({ message: 'Database unavailable' });
    }
});

app.use('/api', globalApiLimiter);

app.use('/api/public', publicRoutes);
app.use('/api/cron', cronRoutes);

app.use('/api', csrfProtection);

app.use('/api/auth', authRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/drafts', draftRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/business-info', businessInfoRoutes);
app.use('/api/products', productRoutes);

app.get('/', (req, res) => {
    res.send('Waraqah API running');
});

app.use(notFoundHandler);
app.use(errorHandler);

if (process.env.VERCEL !== '1') {
    connectDB()
        .then(() => import('./recurringAutomation.js'))
        .then(() => import('./paymentReminderAutomation.js'))
        .catch((err) => console.error('Startup error:', err));

    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

export default app;
