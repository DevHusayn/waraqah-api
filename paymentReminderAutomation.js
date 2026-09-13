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
import { getInvoiceBalanceDue } from './utils/invoicePayments.js';

/** Send reminders for invoices due within 7 days or already overdue. */
const REMINDER_WINDOW_DAYS = 7;
const BATCH_SIZE = 50;

function reminderWindowEndDateString() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const windowEnd = new Date(today);
    windowEnd.setDate(windowEnd.getDate() + REMINDER_WINDOW_DAYS);
    return windowEnd.toISOString().slice(0, 10);
}

async function sendDuePaymentReminders() {
    const windowEndStr = reminderWindowEndDateString();
    const cooldownCutoff = new Date(Date.now() - PAYMENT_REMINDER_COOLDOWN_MS);

    const baseFilter = {
        status: { $in: ['pending', 'partial', 'overdue'] },
        dueDate: { $exists: true, $ne: '', $lte: windowEndStr },
        clientId: { $ne: null },
        $or: [
            { lastPaymentReminderAt: null },
            { lastPaymentReminderAt: { $lt: cooldownCutoff } },
        ],
    };

    let lastId = null;
    let processed = 0;

    while (true) {
        const batchFilter = { ...baseFilter };
        if (lastId) {
            batchFilter._id = { $gt: lastId };
        }

        const candidates = await Invoice.find(batchFilter)
            .sort({ _id: 1 })
            .limit(BATCH_SIZE);

        if (candidates.length === 0) break;
        lastId = candidates[candidates.length - 1]._id;

        const userIds = [...new Set(candidates.map((invoice) => String(invoice.userId)))];
        const businessRows = await BusinessInfo.find({ userId: { $in: userIds } })
            .select('userId autoPaymentReminders')
            .lean();
        const autoRemindersByUser = new Map(
            businessRows.map((row) => [String(row.userId), row.autoPaymentReminders !== false]),
        );

        for (const invoice of candidates) {
            if (autoRemindersByUser.get(String(invoice.userId)) === false) continue;

            const daysUntilDue = computeDaysUntilDue(invoice.dueDate);
            if (daysUntilDue > REMINDER_WINDOW_DAYS) continue;

            try {
                await ensureInvoicePublicToken(invoice);
                const ctx = await loadInvoiceEmailContext(invoice, invoice.userId);

                await sendPaymentReminderEmail({
                    to: ctx.to,
                    customerName: ctx.customerName,
                    invoiceNumber: invoice.invoiceNumber,
                    amountOutstanding: getInvoiceBalanceDue(invoice),
                    currency: invoice.currency || 'NGN',
                    dueDate: invoice.dueDate,
                    daysUntilDue,
                    invoiceUrl: buildInvoiceUrl(invoice),
                    businessName: ctx.businessName,
                    replyTo: ctx.replyTo,
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
                processed += 1;
            } catch (err) {
                console.error('[Waraqah Email] Automated payment reminder failed:', {
                    invoiceId: invoice._id,
                    message: err.message,
                });
            }
        }

        if (candidates.length < BATCH_SIZE) break;
    }

    return { processed };
}

export { sendDuePaymentReminders };
