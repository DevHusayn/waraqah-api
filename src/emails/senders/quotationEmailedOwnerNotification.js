import React from 'react';
import { sendEmail } from '../sendEmail.js';
import QuotationEmailedOwnerNotification from '../templates/QuotationEmailedOwnerNotification.js';
import { formatCurrency, formatDate } from '../formatters.js';
export async function sendQuotationEmailedOwnerNotification({
    to,
    ownerName,
    customerName,
    clientEmail,
    quotationNumber,
    amount,
    currency = 'NGN',
    validUntil,
    quotationDashboardUrl,
    automated = false,
}) {
    const formattedAmount = formatCurrency(amount, currency);
    const prefix = automated ? '[Auto] ' : '';

    return sendEmail({
        to,
        subject: `${prefix}Quotation ${quotationNumber} sent to ${customerName}`,
        type: 'owner-quotation-emailed',
        react: React.createElement(QuotationEmailedOwnerNotification, {
            ownerName,
            customerName,
            clientEmail,
            quotationNumber,
            amount,
            currency,
            validUntil,
            quotationDashboardUrl,
        }),
        text: [
            `Quotation ${quotationNumber} was emailed to your client.`,
            '',
            `Client: ${customerName}`,
            `Sent to: ${clientEmail}`,
            `Estimated total: ${formattedAmount}`,
            ...(validUntil ? [`Valid until: ${formatDate(validUntil)}`] : []),
            '',
            `View in dashboard: ${quotationDashboardUrl}`,
        ].join('\n'),
    });
}
