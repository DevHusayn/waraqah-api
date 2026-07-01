import React from 'react';
import { sendEmail } from '../sendEmail.js';
import InvoiceReminderSentOwnerNotification from '../templates/InvoiceReminderSentOwnerNotification.js';
import { formatCurrency, formatDate, formatDaysUntilDue } from '../formatters.js';

/**
 * Notify the business owner that a payment reminder was sent to a client.
 */
export async function sendInvoiceReminderSentOwnerNotification({
    to,
    ownerName,
    customerName,
    clientEmail,
    invoiceNumber,
    amountOutstanding,
    currency = 'NGN',
    dueDate,
    daysUntilDue,
    automated = false,
    invoiceDashboardUrl,
}) {
    const dueLabel = formatDaysUntilDue(daysUntilDue);
    const prefix = automated ? 'Automated reminder' : 'Payment reminder';

    return sendEmail({
        to,
        subject: `${prefix} sent to ${customerName} — Invoice ${invoiceNumber}`,
        type: automated ? 'owner-reminder-automated' : 'owner-reminder-sent',
        react: React.createElement(InvoiceReminderSentOwnerNotification, {
            ownerName,
            customerName,
            clientEmail,
            invoiceNumber,
            amountOutstanding,
            currency,
            dueDate,
            daysUntilDue,
            automated,
            invoiceDashboardUrl,
        }),
        text: [
            `${prefix} sent for invoice ${invoiceNumber}.`,
            '',
            `Client: ${customerName}`,
            `Sent to: ${clientEmail}`,
            `Amount outstanding: ${formatCurrency(amountOutstanding, currency)}`,
            `Due date: ${formatDate(dueDate)} (${dueLabel})`,
            automated ? 'Sent automatically by Waraqah.' : '',
            '',
            `View in dashboard: ${invoiceDashboardUrl}`,
        ].filter(Boolean).join('\n'),
    });
}
