import React from 'react';
import { sendEmail } from '../sendEmail.js';
import PaymentReminderEmail from '../templates/PaymentReminderEmail.js';
import { formatCurrency, formatDate, formatDaysUntilDue } from '../formatters.js';

/**
 * Send payment reminder for an outstanding invoice.
 *
 * @param {object} params
 * @param {string} params.to - Customer email
 * @param {string} params.customerName - Customer name
 * @param {string} params.invoiceNumber - Invoice number
 * @param {number|string} params.amountOutstanding - Outstanding amount
 * @param {string} [params.currency='NGN'] - Currency code
 * @param {string|Date} params.dueDate - Due date
 * @param {number} params.daysUntilDue - Days until due (negative if overdue)
 * @param {string} params.invoiceUrl - Invoice/payment URL
 * @param {string} params.businessName - Sender business name
 */
export async function sendPaymentReminderEmail({
    to,
    customerName,
    invoiceNumber,
    amountOutstanding,
    currency = 'NGN',
    dueDate,
    daysUntilDue,
    invoiceUrl,
    businessName,
}) {
    const dueLabel = formatDaysUntilDue(daysUntilDue);

    return sendEmail({
        to,
        subject: `Payment reminder — Invoice ${invoiceNumber}`,
        type: 'payment-reminder',
        react: React.createElement(PaymentReminderEmail, {
            customerName,
            invoiceNumber,
            amountOutstanding,
            currency,
            dueDate,
            daysUntilDue,
            invoiceUrl,
            businessName,
        }),
        text: [
            `Payment reminder from ${businessName}`,
            '',
            `Invoice: ${invoiceNumber}`,
            `Amount outstanding: ${formatCurrency(amountOutstanding, currency)}`,
            `Due date: ${formatDate(dueDate)} (${dueLabel})`,
            '',
            `Pay now: ${invoiceUrl}`,
        ].join('\n'),
    });
}
