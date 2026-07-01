import React from 'react';
import { Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { formatCurrency } from '../formatters.js';

export default function InvoiceCancelledClientEmail({
    customerName,
    invoiceNumber,
    amount,
    currency = 'NGN',
    businessName,
}) {
    const greetingName = customerName?.trim() || 'there';

    return React.createElement(
        EmailLayout,
        { preview: `Invoice ${invoiceNumber} from ${businessName} has been cancelled.` },
        React.createElement(Text, { style: emailStyles.heading }, 'Invoice cancelled'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, ${businessName} has cancelled invoice ${invoiceNumber}. No payment is required for this invoice.`,
        ),
        React.createElement(
            Section,
            { style: emailStyles.detailBox },
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Invoice number'),
            React.createElement(Text, { style: emailStyles.detailValue }, invoiceNumber),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Original amount'),
            React.createElement(Text, { style: emailStyles.detailValueLast }, formatCurrency(amount, currency)),
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            'If you already paid this invoice, please contact the business directly.',
        ),
    );
}
