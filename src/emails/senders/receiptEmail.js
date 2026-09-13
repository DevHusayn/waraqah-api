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
    totalAmount,
    balanceDue,
    currency = 'NGN',
    paymentDate,
    paymentMethod,
    businessName,
    replyTo,
    receiptUrl,
    branding,
}) {
    const brand = branding || buildClientEmailBranding(null, businessName);
    const resolvedBalance =
        balanceDue != null
            ? Number(balanceDue)
            : Math.max(0, Number(totalAmount || 0) - Number(amountPaid || 0));
    const isPartial = resolvedBalance > 0.009;

    return sendEmail({
        to,
        from: getClientEmailFromAddress(brand.businessName),
        replyTo,
        subject: `Receipt ${receiptNumber} from ${brand.businessName}`,
        type: 'receipt',
        react: React.createElement(ReceiptEmail, {
            customerName,
            invoiceNumber,
            receiptNumber,
            amountPaid,
            totalAmount,
            balanceDue: resolvedBalance,
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
            isPartial && totalAmount != null
                ? `Receipt total: ${formatCurrency(totalAmount, currency)}`
                : null,
            `${isPartial ? 'Amount received' : 'Amount paid'}: ${formatCurrency(amountPaid, currency)}`,
            isPartial ? `Balance remaining: ${formatCurrency(resolvedBalance, currency)}` : null,
            `Payment date: ${formatDate(paymentDate)}`,
            paymentMethod ? `Payment method: ${paymentMethod}` : null,
            receiptUrl ? `\nView receipt: ${receiptUrl}` : null,
        ].filter(Boolean).join('\n'),
    });
}
