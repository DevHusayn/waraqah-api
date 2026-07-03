import React from 'react';
import { sendEmail } from '../sendEmail.js';
import ReceiptEmail from '../templates/ReceiptEmail.js';
import { formatCurrency, formatDate } from '../formatters.js';

/**
 * Send payment receipt to a customer.
 *
 * @param {object} params
 * @param {string} params.to - Customer email
 * @param {string} params.customerName - Customer name
 * @param {string} [params.invoiceNumber] - Related invoice number
 * @param {string} params.receiptNumber - Receipt number
 * @param {number|string} params.amountPaid - Amount paid
 * @param {string} [params.currency='NGN'] - Currency code
 * @param {string|Date} params.paymentDate - Payment date
 * @param {string} [params.paymentMethod] - Optional payment method label
 * @param {string} params.businessName - Sender business name
 * @param {string} [params.receiptUrl] - Optional link to view receipt online
 */
export async function sendReceiptEmail({
    to,
    customerName,
    invoiceNumber,
    receiptNumber,
    amountPaid,
    currency = 'NGN',
    paymentDate,
    paymentMethod,
    businessName,
    receiptUrl,
}) {
    return sendEmail({
        to,
        subject: `Receipt ${receiptNumber} from ${businessName}`,
        type: 'receipt',
        react: React.createElement(ReceiptEmail, {
            customerName,
            invoiceNumber,
            receiptNumber,
            amountPaid,
            currency,
            paymentDate,
            paymentMethod,
            businessName,
            receiptUrl,
        }),
        text: [
            `Receipt ${receiptNumber} from ${businessName}`,
            invoiceNumber ? `Invoice: ${invoiceNumber}` : null,
            '',
            `Amount paid: ${formatCurrency(amountPaid, currency)}`,
            `Payment date: ${formatDate(paymentDate)}`,
            paymentMethod ? `Payment method: ${paymentMethod}` : null,
            receiptUrl ? `\nView receipt: ${receiptUrl}` : null,
        ].filter(Boolean).join('\n'),
    });
}
