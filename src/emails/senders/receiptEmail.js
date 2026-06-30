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
 * @param {string} params.receiptNumber - Receipt number
 * @param {number|string} params.amountPaid - Amount paid
 * @param {string} [params.currency='NGN'] - Currency code
 * @param {string|Date} params.paymentDate - Payment date
 * @param {string} params.businessName - Sender business name
 */
export async function sendReceiptEmail({
    to,
    customerName,
    receiptNumber,
    amountPaid,
    currency = 'NGN',
    paymentDate,
    businessName,
}) {
    return sendEmail({
        to,
        subject: `Receipt ${receiptNumber} from ${businessName}`,
        type: 'receipt',
        react: React.createElement(ReceiptEmail, {
            customerName,
            receiptNumber,
            amountPaid,
            currency,
            paymentDate,
            businessName,
        }),
        text: [
            `Receipt ${receiptNumber} from ${businessName}`,
            '',
            `Amount paid: ${formatCurrency(amountPaid, currency)}`,
            `Payment date: ${formatDate(paymentDate)}`,
        ].join('\n'),
    });
}
