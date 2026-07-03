import React from 'react';
import { sendEmail } from '../sendEmail.js';
import InvoiceCancelledClientEmail from '../templates/InvoiceCancelledClientEmail.js';
import { formatCurrency } from '../formatters.js';
import { buildClientEmailBranding, getClientEmailFromAddress } from '../helpers/clientEmailBranding.js';

export async function sendInvoiceCancelledClientEmail(props) {
    const brand = props.branding || buildClientEmailBranding(null, props.businessName);

    return sendEmail({
        to: props.to,
        from: getClientEmailFromAddress(brand.businessName),
        subject: `Invoice ${props.invoiceNumber} cancelled — ${brand.businessName}`,
        type: 'invoice-cancelled-client',
        react: React.createElement(InvoiceCancelledClientEmail, {
            ...props,
            businessName: brand.businessName,
            branding: brand,
        }),
        text: [
            `Invoice ${props.invoiceNumber} from ${brand.businessName} has been cancelled.`,
            `Amount: ${formatCurrency(props.amount, props.currency)}`,
            'No payment is required.',
        ].join('\n'),
    });
}
