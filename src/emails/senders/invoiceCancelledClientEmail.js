import React from 'react';
import { sendEmail } from '../sendEmail.js';
import InvoiceCancelledClientEmail from '../templates/InvoiceCancelledClientEmail.js';
import { formatCurrency } from '../formatters.js';

export async function sendInvoiceCancelledClientEmail(props) {
    return sendEmail({
        to: props.to,
        subject: `Invoice ${props.invoiceNumber} cancelled — ${props.businessName}`,
        type: 'invoice-cancelled-client',
        react: React.createElement(InvoiceCancelledClientEmail, props),
        text: [
            `Invoice ${props.invoiceNumber} from ${props.businessName} has been cancelled.`,
            `Amount: ${formatCurrency(props.amount, props.currency)}`,
            'No payment is required.',
        ].join('\n'),
    });
}
