import React from 'react';
import { sendEmail } from '../sendEmail.js';
import InvoiceEmail from '../templates/InvoiceEmail.js';
import { formatCurrency, formatDate } from '../formatters.js';

/**
 * Send invoice notification to a customer.
 *
 * @param {object} params
 * @param {string} params.to - Customer email
 * @param {string} params.customerName - Customer name
 * @param {string} params.invoiceNumber - Invoice number
 * @param {number|string} params.amount - Invoice total
 * @param {string} [params.currency='NGN'] - Currency code
 * @param {string|Date} params.dueDate - Due date
 * @param {string} params.invoiceUrl - Public invoice URL
 * @param {string} params.businessName - Sender business name
 */
export async function sendInvoiceEmail({
    to,
    customerName,
    invoiceNumber,
    amount,
    currency = 'NGN',
    dueDate,
    invoiceUrl,
    businessName,
}) {
    const formattedAmount = formatCurrency(amount, currency);

    return sendEmail({
        to,
        subject: `Invoice ${invoiceNumber} from ${businessName}`,
        type: 'invoice',
        react: React.createElement(InvoiceEmail, {
            customerName,
            invoiceNumber,
            amount,
            currency,
            dueDate,
            invoiceUrl,
            businessName,
        }),
        text: [
            `Invoice ${invoiceNumber} from ${businessName}`,
            '',
            `Amount due: ${formattedAmount}`,
            `Due date: ${formatDate(dueDate)}`,
            '',
            `View invoice: ${invoiceUrl}`,
        ].join('\n'),
    });
}
