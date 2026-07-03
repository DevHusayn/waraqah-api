import { sendInvoiceEmailedOwnerNotification } from '../senders/invoiceEmailedOwnerNotification.js';
import { sendInvoicePaidOwnerNotification } from '../senders/invoicePaidOwnerNotification.js';
import { sendInvoiceReminderSentOwnerNotification } from '../senders/invoiceReminderSentOwnerNotification.js';
import { sendInvoiceReceiptSentOwnerNotification } from '../senders/invoiceReceiptSentOwnerNotification.js';
import { sendInvoiceCancelledOwnerNotification } from '../senders/invoiceCancelledOwnerNotification.js';
import {
    loadOwnerNotificationContext,
    buildOwnerInvoiceUrl,
} from './ownerContext.js';

function logOwnerNotificationFailure(type, err) {
    console.error(`[Waraqah Email] Owner ${type} notification failed:`, err?.message || err);
}

export async function notifyOwnerInvoiceEmailed({
    userId,
    invoice,
    clientEmail,
    customerName,
    automated = false,
}) {
    try {
        const owner = await loadOwnerNotificationContext(userId);
        await sendInvoiceEmailedOwnerNotification({
            to: owner.to,
            ownerName: owner.ownerName,
            customerName,
            clientEmail,
            invoiceNumber: invoice.invoiceNumber,
            amount: invoice.total,
            currency: invoice.currency || 'NGN',
            dueDate: invoice.dueDate,
            invoiceDashboardUrl: buildOwnerInvoiceUrl(invoice),
            automated,
        });
    } catch (err) {
        logOwnerNotificationFailure('invoice-emailed', err);
    }
}

export async function notifyOwnerInvoicePaid({
    userId,
    invoice,
    customerName,
    paymentMethod,
}) {
    try {
        const owner = await loadOwnerNotificationContext(userId);
        await sendInvoicePaidOwnerNotification({
            to: owner.to,
            ownerName: owner.ownerName,
            customerName,
            invoiceNumber: invoice.invoiceNumber,
            receiptNumber: invoice.receiptNumber,
            amountPaid: invoice.total,
            currency: invoice.currency || 'NGN',
            paymentDate: invoice.datePaid || new Date(),
            paymentMethod,
            invoiceDashboardUrl: buildOwnerInvoiceUrl(invoice),
        });
    } catch (err) {
        logOwnerNotificationFailure('invoice-paid', err);
    }
}

export async function notifyOwnerInvoiceReminderSent({
    userId,
    invoice,
    clientEmail,
    customerName,
    daysUntilDue,
    automated = false,
}) {
    try {
        const owner = await loadOwnerNotificationContext(userId);
        await sendInvoiceReminderSentOwnerNotification({
            to: owner.to,
            ownerName: owner.ownerName,
            customerName,
            clientEmail,
            invoiceNumber: invoice.invoiceNumber,
            amountOutstanding: invoice.total,
            currency: invoice.currency || 'NGN',
            dueDate: invoice.dueDate,
            daysUntilDue,
            automated,
            invoiceDashboardUrl: buildOwnerInvoiceUrl(invoice),
        });
    } catch (err) {
        logOwnerNotificationFailure('invoice-reminder-sent', err);
    }
}

export async function notifyOwnerInvoiceReceiptSent({ userId, invoice, clientEmail, customerName }) {
    try {
        const owner = await loadOwnerNotificationContext(userId);
        await sendInvoiceReceiptSentOwnerNotification({
            to: owner.to,
            ownerName: owner.ownerName,
            customerName,
            clientEmail,
            receiptNumber: invoice.receiptNumber,
            invoiceNumber: invoice.invoiceNumber,
            amountPaid: invoice.total,
            currency: invoice.currency || 'NGN',
            paymentDate: invoice.datePaid || new Date(),
            invoiceDashboardUrl: buildOwnerInvoiceUrl(invoice, { view: 'receipt' }),
        });
    } catch (err) {
        logOwnerNotificationFailure('invoice-receipt-sent', err);
    }
}

export async function notifyOwnerInvoiceCancelled({ userId, invoice, customerName, clientEmail }) {
    try {
        const owner = await loadOwnerNotificationContext(userId);
        await sendInvoiceCancelledOwnerNotification({
            to: owner.to,
            ownerName: owner.ownerName,
            customerName,
            clientEmail,
            invoiceNumber: invoice.invoiceNumber,
            amount: invoice.total,
            currency: invoice.currency || 'NGN',
            clientNotified: Boolean(clientEmail),
            invoiceDashboardUrl: buildOwnerInvoiceUrl(invoice),
        });
    } catch (err) {
        logOwnerNotificationFailure('invoice-cancelled', err);
    }
}
