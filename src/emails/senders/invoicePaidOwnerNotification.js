import React from 'react';
import { sendEmail } from '../sendEmail.js';
import InvoicePaidOwnerNotification from '../templates/InvoicePaidOwnerNotification.js';
import { formatCurrency, formatDate } from '../formatters.js';

/**
 * Notify the business owner that an invoice was marked as paid.
 */
export async function sendInvoicePaidOwnerNotification({
    to,
    ownerName,
    customerName,
    invoiceNumber,
    receiptNumber,
    amountPaid,
    currency = 'NGN',
    paymentDate,
    paymentMethod,
    invoiceDashboardUrl,
}) {
    return sendEmail({
        to,
        subject: `Payment received — Invoice ${invoiceNumber}`,
        type: 'owner-invoice-paid',
        react: React.createElement(InvoicePaidOwnerNotification, {
            ownerName,
            customerName,
            invoiceNumber,
            receiptNumber,
            amountPaid,
            currency,
            paymentDate,
            paymentMethod,
            invoiceDashboardUrl,
        }),
        text: [
            `Payment received for invoice ${invoiceNumber}.`,
            '',
            `Client: ${customerName}`,
            `Amount: ${formatCurrency(amountPaid, currency)}`,
            `Payment date: ${formatDate(paymentDate)}`,
            paymentMethod ? `Payment method: ${paymentMethod}` : null,
            receiptNumber ? `Receipt: ${receiptNumber}` : null,
            '',
            `View invoice: ${invoiceDashboardUrl}`,
        ].filter(Boolean).join('\n'),
    });
}
