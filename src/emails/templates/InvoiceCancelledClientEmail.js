import React from 'react';
import { Section, Text } from '@react-email/components';
import ClientEmailLayout, { createClientEmailStyles } from '../layouts/ClientEmailLayout.js';
import { buildClientEmailBranding } from '../helpers/clientEmailBranding.js';
import { formatCurrency } from '../formatters.js';

export default function InvoiceCancelledClientEmail({
    customerName,
    invoiceNumber,
    amount,
    currency = 'NGN',
    businessName,
    branding,
}) {
    const brand = branding || buildClientEmailBranding(null, businessName);
    const emailStyles = createClientEmailStyles(brand);
    const greetingName = customerName?.trim() || 'there';

    return React.createElement(
        ClientEmailLayout,
        {
            preview: `Invoice ${invoiceNumber} from ${brand.businessName} has been cancelled.`,
            branding: brand,
        },
        React.createElement(Text, { style: emailStyles.heading }, 'Invoice cancelled'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, ${brand.businessName} has cancelled invoice ${invoiceNumber}. No payment is required for this invoice.`,
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
