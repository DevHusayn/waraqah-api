import cron from 'node-cron';
import Invoice from './models/Invoice.js';
import BusinessInfo from './models/CompanyInfo.js';
import {
    sendPaymentReminderEmail,
} from './src/emails/index.js';
import { PAYMENT_REMINDER_COOLDOWN_MS } from './src/emails/config.js';
import {
    loadInvoiceEmailContext,
    buildInvoiceUrl,
    computeDaysUntilDue,
} from './src/emails/helpers/invoiceContext.js';
import { ensureInvoicePublicToken } from './utils/invoicePublicToken.js';
import { notifyOwnerInvoiceReminderSent } from './src/emails/helpers/ownerNotifications.js';

/** Send reminders for invoices due within 7 days or already overdue. */
const REMINDER_WINDOW_DAYS = 7;

async function sendDuePaymentReminders() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const windowEnd = new Date(today);
    windowEnd.setDate(windowEnd.getDate() + REMINDER_WINDOW_DAYS);

    const candidates = await Invoice.find({
        status: { $in: ['pending', 'overdue'] },
        dueDate: { $exists: true, $ne: '' },
        clientId: { $ne: null },
    });

    const userIds = [...new Set(candidates.map((invoice) => String(invoice.userId)))];
    const businessRows = userIds.length
        ? await BusinessInfo.find({ userId: { $in: userIds } })
            .select('userId autoPaymentReminders')
            .lean()
        : [];
    const autoRemindersByUser = new Map(
        businessRows.map((row) => [String(row.userId), row.autoPaymentReminders !== false]),
    );

    for (const invoice of candidates) {
        if (autoRemindersByUser.get(String(invoice.userId)) === false) continue;
        const daysUntilDue = computeDaysUntilDue(invoice.dueDate);
        const isDueSoon = daysUntilDue <= REMINDER_WINDOW_DAYS;
        if (!isDueSoon) continue;

        const lastReminder = invoice.lastPaymentReminderAt?.getTime() || 0;
        if (Date.now() - lastReminder < PAYMENT_REMINDER_COOLDOWN_MS) continue;

        try {
            await ensureInvoicePublicToken(invoice);
            const ctx = await loadInvoiceEmailContext(invoice, invoice.userId);

            await sendPaymentReminderEmail({
                to: ctx.to,
                customerName: ctx.customerName,
                invoiceNumber: invoice.invoiceNumber,
                amountOutstanding: invoice.total,
                currency: invoice.currency || 'NGN',
                dueDate: invoice.dueDate,
                daysUntilDue,
                invoiceUrl: buildInvoiceUrl(invoice),
                businessName: ctx.businessName,
                branding: ctx.branding,
            });

            invoice.lastPaymentReminderAt = new Date();
            await invoice.save();

            await notifyOwnerInvoiceReminderSent({
                userId: invoice.userId,
                invoice,
                clientEmail: ctx.to,
                customerName: ctx.customerName,
                daysUntilDue,
                automated: true,
            });
        } catch (err) {
            console.error('[Waraqah Email] Automated payment reminder failed:', {
                invoiceId: invoice._id,
                message: err.message,
            });
        }
    }
}

cron.schedule('0 9 * * *', async () => {
    try {
        await sendDuePaymentReminders();
        console.log('[Waraqah Email] Payment reminder automation ran.');
    } catch (err) {
        console.error('[Waraqah Email] Payment reminder automation error:', err);
    }
});

export { sendDuePaymentReminders };
