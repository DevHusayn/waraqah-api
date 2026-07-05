import express from 'express';
import { sendDuePaymentReminders } from '../paymentReminderAutomation.js';
import { syncAllOverdueInvoices } from '../utils/invoiceOverdue.js';
import asyncHandler from '../middleware/asyncHandler.js';

const router = express.Router();

function verifyCronSecret(req, res, next) {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) {
        return res.status(503).json({ message: 'Cron is not configured.' });
    }

    const authHeader = req.headers.authorization || '';
    if (authHeader !== `Bearer ${secret}`) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    return next();
}

/** Vercel Cron — daily payment reminder emails to clients. */
router.get('/payment-reminders', verifyCronSecret, asyncHandler(async (req, res) => {
    await sendDuePaymentReminders();
    res.json({ ok: true, message: 'Payment reminders processed.' });
}));

/** Vercel Cron — mark pending invoices past due as overdue (all users). */
router.get('/overdue-sync', verifyCronSecret, asyncHandler(async (req, res) => {
    const { modifiedCount } = await syncAllOverdueInvoices();
    res.json({ ok: true, message: 'Overdue invoices synced.', modifiedCount });
}));

export default router;
