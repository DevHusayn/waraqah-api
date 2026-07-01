import React from 'react';
import { sendEmail } from '../sendEmail.js';
import InvoiceReceiptSentOwnerNotification from '../templates/InvoiceReceiptSentOwnerNotification.js';
import { formatCurrency, formatDate } from '../formatters.js';

export async function sendInvoiceReceiptSentOwnerNotification(props) {
    return sendEmail({
        to: props.to,
        subject: `Receipt ${props.receiptNumber} sent to ${props.customerName}`,
        type: 'owner-receipt-sent',
        react: React.createElement(InvoiceReceiptSentOwnerNotification, props),
        text: [
            `Receipt ${props.receiptNumber} was emailed to ${props.customerName}.`,
            `Sent to: ${props.clientEmail}`,
            `Amount: ${formatCurrency(props.amountPaid, props.currency)}`,
            `Payment date: ${formatDate(props.paymentDate)}`,
            `View: ${props.invoiceDashboardUrl}`,
        ].join('\n'),
    });
}
