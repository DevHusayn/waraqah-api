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
import receiptRoutes from './routes/receipts.js';
import draftRoutes from './routes/drafts.js';
import clientRoutes from './routes/clients.js';
import businessInfoRoutes from './routes/companyInfo.js';
import productRoutes from './routes/products.js';
import supplierRoutes from './routes/suppliers.js';
import purchaseOrderRoutes from './routes/purchaseOrders.js';
import inventoryRoutes from './routes/inventory.js';
import aiRoutes from './routes/ai.js';
import dashboardRoutes from './routes/dashboard.js';
import profitRoutes from './routes/profit.js';
import expenseRoutes from './routes/expenses.js';
import staffRoutes from './routes/staff.js';
import paymentRoutes, { paystackWebhookHandler } from './routes/payments.js';
import publicRoutes from './routes/publicInvoices.js';
import cronRoutes from './routes/cron.js';
import { buildCorsOptions } from './utils/corsConfig.js';
import { assertEnvOrExit } from './utils/envValidation.js';
import { readApiLimiter, writeApiLimiter } from './middleware/rateLimits.js';
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
    express.raw({ type: 'application/json' }),
    paystackWebhookHandler
);
// Webhook is public: no auth, CSRF, or global rate limiters (registered above middleware stack).

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(mongoSanitize());

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/waraqah';
const MONGO_CONNECT_TIMEOUT_MS = 8000;

let dbReady = false;
let connectPromise = null;

function waitWithTimeout(promise, timeoutMs, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
    ]);
}

async function resetMongoConnection() {
    dbReady = false;
    connectPromise = null;
    if (mongoose.connection.readyState === 0) return;
    try {
        await mongoose.disconnect();
    } catch {
        /* best effort */
    }
}

async function connectDB() {
    if (mongoose.connection.readyState === 1) {
        dbReady = true;
        return;
    }

    if (connectPromise) {
        await connectPromise;
        return;
    }

    connectPromise = (async () => {
        if (mongoose.connection.readyState === 2) {
            try {
                await waitWithTimeout(
                    mongoose.connection.asPromise(),
                    MONGO_CONNECT_TIMEOUT_MS,
                    'MongoDB connection'
                );
            } catch {
                await resetMongoConnection();
            }
        }

        if (mongoose.connection.readyState !== 1) {
            await mongoose.connect(MONGO_URI, {
                serverSelectionTimeoutMS: MONGO_CONNECT_TIMEOUT_MS,
                socketTimeoutMS: 45000,
                maxPoolSize: process.env.VERCEL === '1' ? 10 : 50,
            });
            console.log('MongoDB connected');
        }

        dbReady = true;
    })();

    try {
        await connectPromise;
    } finally {
        connectPromise = null;
    }
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

app.use('/api', readApiLimiter);
app.use('/api', writeApiLimiter);

app.use('/api/public', publicRoutes);
app.use('/api/cron', cronRoutes);

app.use('/api', csrfProtection);

app.use('/api/auth', authRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/profit', profitRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/receipts', receiptRoutes);
app.use('/api/drafts', draftRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/business-info', businessInfoRoutes);
app.use('/api/products', productRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/ai', aiRoutes);

app.get('/', (req, res) => {
    res.send('Waraqah API running');
});

app.use(notFoundHandler);
app.use(errorHandler);

if (process.env.VERCEL !== '1') {
    connectDB()
        .then(() => import('./recurringAutomation.js'))
        .then(() => import('./paymentReminderCron.js'))
        .then(() => import('./lowStockAlertCron.js'))
        .then(() => import('./monthlyStatementCron.js'))
        .catch((err) => console.error('Startup error:', err));

    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

export default app;
