import React from 'react';
import { sendEmail } from '../sendEmail.js';
import ReceiptEmail from '../templates/ReceiptEmail.js';
import { formatCurrency, formatDate } from '../formatters.js';
import { buildClientEmailBranding, getClientEmailFromAddress } from '../helpers/clientEmailBranding.js';

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
 * @param {object} [params.branding] - Business branding tokens
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
    branding,
}) {
    const brand = branding || buildClientEmailBranding(null, businessName);

    return sendEmail({
        to,
        from: getClientEmailFromAddress(brand.businessName),
        subject: `Receipt ${receiptNumber} from ${brand.businessName}`,
        type: 'receipt',
        react: React.createElement(ReceiptEmail, {
            customerName,
            invoiceNumber,
            receiptNumber,
            amountPaid,
            currency,
            paymentDate,
            paymentMethod,
            businessName: brand.businessName,
            receiptUrl,
            branding: brand,
        }),
        text: [
            `Receipt ${receiptNumber} from ${brand.businessName}`,
            invoiceNumber ? `Invoice: ${invoiceNumber}` : null,
            '',
            `Amount paid: ${formatCurrency(amountPaid, currency)}`,
            `Payment date: ${formatDate(paymentDate)}`,
            paymentMethod ? `Payment method: ${paymentMethod}` : null,
            receiptUrl ? `\nView receipt: ${receiptUrl}` : null,
        ].filter(Boolean).join('\n'),
    });
}
