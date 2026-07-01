import React from 'react';
import { sendEmail } from '../sendEmail.js';
import InvoiceCancelledOwnerNotification from '../templates/InvoiceCancelledOwnerNotification.js';
import { formatCurrency } from '../formatters.js';

export async function sendInvoiceCancelledOwnerNotification(props) {
    return sendEmail({
        to: props.to,
        subject: `Invoice ${props.invoiceNumber} cancelled`,
        type: 'owner-invoice-cancelled',
        react: React.createElement(InvoiceCancelledOwnerNotification, props),
        text: [
            `Invoice ${props.invoiceNumber} was cancelled.`,
            props.clientEmail ? `Client notified: ${props.clientEmail}` : 'Client was not emailed.',
            `Amount: ${formatCurrency(props.amount, props.currency)}`,
            `View: ${props.invoiceDashboardUrl}`,
        ].join('\n'),
    });
}
