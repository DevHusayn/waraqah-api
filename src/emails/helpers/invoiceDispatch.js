import Client from '../../../models/Client.js';
import BusinessInfo from '../../../models/CompanyInfo.js';
import { PAYMENT_REMINDER_COOLDOWN_MS } from '../config.js';
import { sendInvoiceEmail } from '../senders/invoiceEmail.js';
import { sendPaymentReminderEmail } from '../senders/paymentReminderEmail.js';
import { sendPaymentConfirmationEmail } from '../senders/paymentConfirmationEmail.js';
import { sendPartialPaymentEmail } from '../senders/partialPaymentEmail.js';
import { sendInvoiceCancelledClientEmail } from '../senders/invoiceCancelledClientEmail.js';
import {
    loadInvoiceEmailContext,
    buildInvoiceUrl,
    buildReceiptUrl,
    formatPaymentMethod,
    computeDaysUntilDue,
} from './invoiceContext.js';
import { ensureInvoicePublicToken } from '../../../utils/invoicePublicToken.js';
import {
    notifyOwnerInvoiceEmailed,
    notifyOwnerInvoicePaid,
    notifyOwnerInvoicePartialPayment,
    notifyOwnerInvoiceReminderSent,
    notifyOwnerInvoiceReceiptSent,
    notifyOwnerInvoiceCancelled,
} from './ownerNotifications.js';

export async function shouldAutoEmailInvoices(userId) {
    const info = await BusinessInfo.findOne({ userId }).select('autoEmailInvoices');
    return Boolean(info?.autoEmailInvoices);
}

export async function shouldAutoPaymentReminders(userId) {
    const info = await BusinessInfo.findOne({ userId }).select('autoPaymentReminders');
    return info?.autoPaymentReminders !== false;
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
        replyTo: ctx.replyTo,
        branding: ctx.branding,
    });

    invoice.clientInvoiceEmailedAt = new Date();
    await invoice.save();

    if (notifyOwner) {
        await notifyOwnerInvoiceEmailed({
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
        if (!(await shouldAutoPaymentReminders(userId))) return;

        const lastReminder = invoice.lastPaymentReminderAt?.getTime() || 0;
        if (Date.now() - lastReminder < PAYMENT_REMINDER_COOLDOWN_MS) return;

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
            replyTo: ctx.replyTo,
            branding: ctx.branding,
        });

        invoice.lastPaymentReminderAt = new Date();
        await invoice.save();

        await notifyOwnerInvoiceReminderSent({
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

/**
 * Notify client of payment + owner when an invoice is marked paid.
 * Sends payment confirmation (not receipt — use send-receipt for that).
 */
export async function dispatchPaidInvoiceEmails(invoice, userId) {
    try {
        await ensureInvoicePublicToken(invoice);
        const ctx = await loadInvoiceEmailContext(invoice, userId);
        const receiptUrl = buildReceiptUrl(invoice);

        await sendPaymentConfirmationEmail({
            to: ctx.to,
            customerName: ctx.customerName,
            invoiceNumber: invoice.invoiceNumber,
            amountPaid: Number(invoice.amountPaid) > 0 ? Number(invoice.amountPaid) : invoice.total,
            currency: invoice.currency || 'NGN',
            paymentDate: invoice.datePaid || new Date(),
            paymentMethod: formatPaymentMethod(invoice.paymentMethod),
            businessName: ctx.businessName,
            replyTo: ctx.replyTo,
            branding: ctx.branding,
            receiptUrl,
        });

        await notifyOwnerInvoicePaid({
            userId,
            invoice,
            customerName: ctx.customerName,
            paymentMethod: formatPaymentMethod(invoice.paymentMethod),
        });
    } catch (err) {
        console.error('[Waraqah Email] Paid invoice emails skipped:', err.message);
    }
}

/**
 * Notify client and owner when a partial installment is recorded.
 */
export async function dispatchPartialPaymentEmails(invoice, userId, payment) {
    try {
        await ensureInvoicePublicToken(invoice);
        const amountPaid = Number(invoice.amountPaid) > 0 ? Number(invoice.amountPaid) : 0;
        const balanceDue = Math.max(0, Number(invoice.total || 0) - amountPaid);
        const paymentMethod = formatPaymentMethod(payment?.method || invoice.paymentMethod);
        const paymentDate = payment?.date || invoice.datePaid || new Date();
        const paymentAmount = Number(payment?.amount) || 0;

        let customerName = 'Customer';
        let ctx = null;
        try {
            ctx = await loadInvoiceEmailContext(invoice, userId);
            customerName = ctx.customerName;
            await sendPartialPaymentEmail({
                to: ctx.to,
                customerName: ctx.customerName,
                invoiceNumber: invoice.invoiceNumber,
                paymentAmount,
                amountPaid,
                balanceDue,
                currency: invoice.currency || 'NGN',
                paymentDate,
                paymentMethod,
                dueDate: invoice.dueDate,
                invoiceUrl: buildInvoiceUrl(invoice),
                businessName: ctx.businessName,
                replyTo: ctx.replyTo,
                branding: ctx.branding,
            });
        } catch (err) {
            if (err.status === 400) {
                if (invoice.clientId) {
                    const client = await Client.findOne({ _id: invoice.clientId, userId });
                    customerName = client?.name || client?.company || customerName;
                }
            } else {
                console.error('[Waraqah Email] Partial payment client email skipped:', err.message);
            }
        }

        await notifyOwnerInvoicePartialPayment({
            userId,
            invoice,
            customerName,
            paymentAmount,
            amountPaid,
            balanceDue,
            paymentMethod,
            paymentDate,
        });
    } catch (err) {
        console.error('[Waraqah Email] Partial payment emails skipped:', err.message);
    }
}

export async function dispatchCancelledInvoiceEmails({ invoice, userId }) {
    try {
        const ctx = await loadInvoiceEmailContext(invoice, userId).catch(() => null);

        if (ctx?.to) {
            await sendInvoiceCancelledClientEmail({
                to: ctx.to,
                customerName: ctx.customerName,
                invoiceNumber: invoice.invoiceNumber,
                amount: invoice.total,
                currency: invoice.currency || 'NGN',
                businessName: ctx.businessName,
                replyTo: ctx.replyTo,
                branding: ctx.branding,
            });
        }

        await notifyOwnerInvoiceCancelled({
            userId,
            invoice,
            customerName: ctx?.customerName || 'Client',
            clientEmail: ctx?.to || '',
        });
    } catch (err) {
        console.error('[Waraqah Email] Cancelled invoice emails skipped:', err.message);
    }
}
