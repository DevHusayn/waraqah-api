import React from 'react';
import { sendEmail } from '../sendEmail.js';
import InvoiceEmailedOwnerNotification from '../templates/InvoiceEmailedOwnerNotification.js';
import { formatCurrency, formatDate } from '../formatters.js';

/**
 * Notify the business owner that an invoice was emailed to a client.
 */
export async function sendInvoiceEmailedOwnerNotification({
    to,
    ownerName,
    customerName,
    clientEmail,
    invoiceNumber,
    amount,
    currency = 'NGN',
    dueDate,
    invoiceDashboardUrl,
}) {
    return sendEmail({
        to,
        subject: `Invoice ${invoiceNumber} sent to ${customerName}`,
        type: 'owner-invoice-emailed',
        react: React.createElement(InvoiceEmailedOwnerNotification, {
            ownerName,
            customerName,
            clientEmail,
            invoiceNumber,
            amount,
            currency,
            dueDate,
            invoiceDashboardUrl,
        }),
        text: [
            `Invoice ${invoiceNumber} was emailed to your client.`,
            '',
            `Client: ${customerName}`,
            `Sent to: ${clientEmail}`,
            `Amount: ${formatCurrency(amount, currency)}`,
            `Due date: ${formatDate(dueDate)}`,
            '',
            `View in dashboard: ${invoiceDashboardUrl}`,
        ].join('\n'),
    });
}
