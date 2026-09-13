import React from 'react';
import { sendEmail } from '../sendEmail.js';
import PartialPaymentEmail from '../templates/PartialPaymentEmail.js';
import { formatCurrency, formatDate } from '../formatters.js';
import { buildClientEmailBranding, getClientEmailFromAddress } from '../helpers/clientEmailBranding.js';

/**
 * Send partial payment confirmation after an installment is recorded.
 */
export async function sendPartialPaymentEmail({
    to,
    customerName,
    invoiceNumber,
    paymentAmount,
    amountPaid,
    balanceDue,
    currency = 'NGN',
    paymentDate,
    paymentMethod,
    dueDate,
    invoiceUrl,
    businessName,
    replyTo,
    branding,
}) {
    const brand = branding || buildClientEmailBranding(null, businessName);

    return sendEmail({
        to,
        from: getClientEmailFromAddress(brand.businessName),
        replyTo,
        subject: `Partial payment received — Invoice ${invoiceNumber}`,
        type: 'partial-payment',
        react: React.createElement(PartialPaymentEmail, {
            customerName,
            invoiceNumber,
            paymentAmount,
            amountPaid,
            balanceDue,
            currency,
            paymentDate,
            paymentMethod,
            dueDate,
            invoiceUrl,
            businessName: brand.businessName,
            branding: brand,
        }),
        text: [
            `Partial payment received for invoice ${invoiceNumber}`,
            '',
            `Payment received: ${formatCurrency(paymentAmount, currency)}`,
            `Total paid so far: ${formatCurrency(amountPaid, currency)}`,
            `Balance due: ${formatCurrency(balanceDue, currency)}`,
            `Payment date: ${formatDate(paymentDate)}`,
            paymentMethod ? `Payment method: ${paymentMethod}` : null,
            dueDate ? `Due date: ${formatDate(dueDate)}` : null,
            invoiceUrl ? `\nView invoice: ${invoiceUrl}` : null,
        ].filter(Boolean).join('\n'),
    });
}
