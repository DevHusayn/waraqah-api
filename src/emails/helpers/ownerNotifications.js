import { sendInvoiceEmailedOwnerNotification } from '../senders/invoiceEmailedOwnerNotification.js';
import { sendInvoicePaidOwnerNotification } from '../senders/invoicePaidOwnerNotification.js';
import { sendInvoiceReminderSentOwnerNotification } from '../senders/invoiceReminderSentOwnerNotification.js';
import {
    loadOwnerNotificationContext,
    buildOwnerInvoiceUrl,
} from './ownerContext.js';

function logOwnerNotificationFailure(type, err) {
    console.error(`[Waraqah Email] Owner ${type} notification failed:`, err?.message || err);
}

/**
 * Fire-and-forget: notify business owner after invoice is emailed to client.
 */
export function notifyOwnerInvoiceEmailed({
    userId,
    invoice,
    clientEmail,
    customerName,
}) {
    Promise.resolve()
        .then(async () => {
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
                invoiceDashboardUrl: buildOwnerInvoiceUrl(invoice._id),
            });
        })
        .catch((err) => logOwnerNotificationFailure('invoice-emailed', err));
}

/**
 * Fire-and-forget: notify business owner after invoice is marked paid.
 */
export function notifyOwnerInvoicePaid({
    userId,
    invoice,
    customerName,
    paymentMethod,
}) {
    Promise.resolve()
        .then(async () => {
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
                invoiceDashboardUrl: buildOwnerInvoiceUrl(invoice._id),
            });
        })
        .catch((err) => logOwnerNotificationFailure('invoice-paid', err));
}

/**
 * Fire-and-forget: notify business owner after a payment reminder is sent to a client.
 */
export function notifyOwnerInvoiceReminderSent({
    userId,
    invoice,
    clientEmail,
    customerName,
    daysUntilDue,
    automated = false,
}) {
    Promise.resolve()
        .then(async () => {
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
                invoiceDashboardUrl: buildOwnerInvoiceUrl(invoice._id),
            });
        })
        .catch((err) => logOwnerNotificationFailure('invoice-reminder-sent', err));
}
