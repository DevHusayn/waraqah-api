import BusinessInfo from '../../../models/CompanyInfo.js';
import { sendInvoiceEmail } from '../senders/invoiceEmail.js';
import { sendPaymentReminderEmail } from '../senders/paymentReminderEmail.js';
import { sendInvoiceCancelledClientEmail } from '../senders/invoiceCancelledClientEmail.js';
import {
    loadInvoiceEmailContext,
    buildInvoiceUrl,
    computeDaysUntilDue,
} from './invoiceContext.js';
import { ensureInvoicePublicToken } from '../../../utils/invoicePublicToken.js';
import {
    notifyOwnerInvoiceEmailed,
    notifyOwnerInvoiceReminderSent,
    notifyOwnerInvoiceReceiptSent,
    notifyOwnerInvoiceCancelled,
} from './ownerNotifications.js';

export async function shouldAutoEmailInvoices(userId) {
    const info = await BusinessInfo.findOne({ userId }).select('autoEmailInvoices');
    return Boolean(info?.autoEmailInvoices);
}

/**
 * Send invoice email to client (+ optional owner copy).
 */
export async function dispatchInvoiceEmailToClient({
    invoice,
    userId,
    notifyOwner = true,
    automated = false,
}) {
    await ensureInvoicePublicToken(invoice);
    const ctx = await loadInvoiceEmailContext(invoice, userId);

    await sendInvoiceEmail({
        to: ctx.to,
        customerName: ctx.customerName,
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.total,
        currency: invoice.currency || 'NGN',
        dueDate: invoice.dueDate,
        invoiceUrl: buildInvoiceUrl(invoice),
        businessName: ctx.businessName,
    });

    invoice.clientInvoiceEmailedAt = new Date();
    await invoice.save();

    if (notifyOwner) {
        notifyOwnerInvoiceEmailed({
            userId,
            invoice,
            clientEmail: ctx.to,
            customerName: ctx.customerName,
            automated,
        });
    }

    return { sentTo: ctx.to, publicUrl: buildInvoiceUrl(invoice) };
}

export async function tryAutoEmailInvoice({ invoice, userId }) {
    if (invoice.status === 'draft' || !invoice.clientId) return null;
    if (!(await shouldAutoEmailInvoices(userId))) return null;

    try {
        return await dispatchInvoiceEmailToClient({
            invoice,
            userId,
            notifyOwner: true,
            automated: true,
        });
    } catch (err) {
        console.error('[Waraqah Email] Auto-email invoice failed:', err.message);
        return null;
    }
}

export async function dispatchOverdueInvoiceEmails({ invoice, userId }) {
    try {
        await ensureInvoicePublicToken(invoice);
        const ctx = await loadInvoiceEmailContext(invoice, userId);
        const daysUntilDue = computeDaysUntilDue(invoice.dueDate);

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
        });

        invoice.lastPaymentReminderAt = new Date();
        await invoice.save();

        notifyOwnerInvoiceReminderSent({
            userId,
            invoice,
            clientEmail: ctx.to,
            customerName: ctx.customerName,
            daysUntilDue,
            automated: true,
        });
    } catch (err) {
        console.error('[Waraqah Email] Overdue invoice emails skipped:', err.message);
    }
}

export async function dispatchCancelledInvoiceEmails({ invoice, userId }) {
    try {
        const ctx = await loadInvoiceEmailContext(invoice, userId).catch(() => null);
        const businessInfo = await BusinessInfo.findOne({ userId });
        const businessName = businessInfo?.name?.trim() || 'Your business';

        if (ctx?.to) {
            await sendInvoiceCancelledClientEmail({
                to: ctx.to,
                customerName: ctx.customerName,
                invoiceNumber: invoice.invoiceNumber,
                amount: invoice.total,
                currency: invoice.currency || 'NGN',
                businessName,
            });
        }

        notifyOwnerInvoiceCancelled({
            userId,
            invoice,
            customerName: ctx?.customerName || 'Client',
            clientEmail: ctx?.to || '',
        });
    } catch (err) {
        console.error('[Waraqah Email] Cancelled invoice emails skipped:', err.message);
    }
}
