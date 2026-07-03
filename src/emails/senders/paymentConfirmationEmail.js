import React from 'react';
import { sendEmail } from '../sendEmail.js';
import PaymentConfirmationEmail from '../templates/PaymentConfirmationEmail.js';
import { formatCurrency, formatDate } from '../formatters.js';
import { buildClientEmailBranding, getClientEmailFromAddress } from '../helpers/clientEmailBranding.js';

/**
 * Send payment confirmation after successful payment.
 *
 * @param {object} params
 * @param {string} params.to - Customer email
 * @param {string} params.customerName - Customer name
 * @param {string} params.invoiceNumber - Invoice number
 * @param {number|string} params.amountPaid - Amount paid
 * @param {string} [params.currency='NGN'] - Currency code
 * @param {string|Date} params.paymentDate - Payment date
 * @param {string} [params.paymentMethod] - Payment method label
 * @param {string} params.businessName - Sender business name
 * @param {string} [params.receiptUrl] - Optional receipt URL
 * @param {object} [params.branding] - Business branding tokens
 */
export async function sendPaymentConfirmationEmail({
    to,
    customerName,
    invoiceNumber,
    amountPaid,
    currency = 'NGN',
    paymentDate,
    paymentMethod,
    businessName,
    receiptUrl,
    branding,
}) {
    const brand = branding || buildClientEmailBranding(null, businessName);

    return sendEmail({
        to,
        from: getClientEmailFromAddress(brand.businessName),
        subject: `Payment confirmed — Invoice ${invoiceNumber}`,
        type: 'payment-confirmation',
        react: React.createElement(PaymentConfirmationEmail, {
            customerName,
            invoiceNumber,
            amountPaid,
            currency,
            paymentDate,
            paymentMethod,
            businessName: brand.businessName,
            receiptUrl,
            branding: brand,
        }),
        text: [
            `Payment confirmed for invoice ${invoiceNumber}`,
            '',
            `Amount paid: ${formatCurrency(amountPaid, currency)}`,
            `Payment date: ${formatDate(paymentDate)}`,
            paymentMethod ? `Payment method: ${paymentMethod}` : null,
            receiptUrl ? `\nView receipt: ${receiptUrl}` : null,
        ].filter(Boolean).join('\n'),
    });
}
