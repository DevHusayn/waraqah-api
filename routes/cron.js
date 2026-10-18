import express from 'express';
import { sendDuePaymentReminders } from '../paymentReminderAutomation.js';
import { sendPremiumExpiryReminders } from '../premiumExpiryReminderAutomation.js';
import { sendLowStockDigests } from '../lowStockAlertAutomation.js';
import { sendMonthlyStatements } from '../monthlyStatementAutomation.js';
import { enqueueLifecycleFollowUps } from '../utils/lifecycleFollowUpService.js';
import { generateRecurringInvoices } from '../utils/recurringInvoices.js';
import { generateRecurringExpenses } from '../utils/recurringExpenses.js';
import { syncAllOverdueInvoices } from '../utils/invoiceOverdue.js';
import { syncAllExpiredQuotations } from '../utils/quotationExpire.js';
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

/** Vercel Cron — remind non-renewing Premium users before access ends. */
router.get('/premium-expiry-reminders', verifyCronSecret, asyncHandler(async (req, res) => {
    const { processed } = await sendPremiumExpiryReminders();
    res.json({ ok: true, message: 'Premium expiry reminders processed.', processed });
}));

/** Vercel Cron — mark pending invoices past due as overdue (all users). */
router.get('/overdue-sync', verifyCronSecret, asyncHandler(async (req, res) => {
    const { modifiedCount } = await syncAllOverdueInvoices();
    res.json({ ok: true, message: 'Overdue invoices synced.', modifiedCount });
}));

/** Vercel Cron — mark sent/accepted quotations past validUntil as expired. */
router.get('/expire-quotations', verifyCronSecret, asyncHandler(async (req, res) => {
    const { modifiedCount } = await syncAllExpiredQuotations();
    res.json({ ok: true, message: 'Expired quotations synced.', modifiedCount });
}));

/** Vercel Cron — generate invoices from active recurring templates. */
router.get('/recurring-invoices', verifyCronSecret, asyncHandler(async (req, res) => {
    const { createdCount } = await generateRecurringInvoices();
    res.json({ ok: true, message: 'Recurring invoices processed.', createdCount });
}));

/** Vercel Cron — generate expenses from active recurring templates. */
router.get('/recurring-expenses', verifyCronSecret, asyncHandler(async (req, res) => {
    const { createdCount } = await generateRecurringExpenses();
    res.json({ ok: true, message: 'Recurring expenses processed.', createdCount });
}));

/** Vercel Cron — daily low-stock digest for opted-in users. */
router.get('/low-stock-alerts', verifyCronSecret, asyncHandler(async (req, res) => {
    const { processed, skipped } = await sendLowStockDigests();
    res.json({ ok: true, message: 'Low stock alerts processed.', processed, skipped });
}));

/** Vercel Cron — monthly billing statement PDFs for Premium users (opt-out). */
router.get('/monthly-statements', verifyCronSecret, asyncHandler(async (req, res) => {
    const forcePeriodKey = typeof req.query.period === 'string' ? req.query.period.trim() : null;
    const { processed, skipped } = await sendMonthlyStatements({ forcePeriodKey });
    res.json({ ok: true, message: 'Monthly statements processed.', processed, skipped });
}));

/** Vercel Cron — enqueue lifecycle follow-up emails for admin review (does not send). */
router.get('/lifecycle-follow-ups', verifyCronSecret, asyncHandler(async (req, res) => {
    const { enqueued, cancelled } = await enqueueLifecycleFollowUps();
    res.json({ ok: true, message: 'Lifecycle follow-ups queued.', enqueued, cancelled });
}));

export default router;
