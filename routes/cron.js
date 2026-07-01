import express from 'express';
import { sendDuePaymentReminders } from '../paymentReminderAutomation.js';

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
router.get('/payment-reminders', verifyCronSecret, async (req, res) => {
    try {
        await sendDuePaymentReminders();
        res.json({ ok: true, message: 'Payment reminders processed.' });
    } catch (err) {
        console.error('[Waraqah Cron] Payment reminders failed:', err);
        res.status(500).json({ message: 'Payment reminder job failed.' });
    }
});

export default router;
