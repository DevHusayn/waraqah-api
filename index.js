import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import invoiceRoutes from './routes/invoices.js';
import clientRoutes from './routes/clients.js';
import businessInfoRoutes from './routes/companyInfo.js';
import paymentRoutes, { paystackWebhookHandler } from './routes/payments.js';

dotenv.config();

const app = express();
app.use(cors());

app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), paystackWebhookHandler);

app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/waraqah';

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch((err) => console.error('MongoDB connection error:', err));

app.use('/api/auth', authRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/business-info', businessInfoRoutes);

app.get('/', (req, res) => {
    res.send('Waraqah API running');
});

import './recurringAutomation.js';

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
