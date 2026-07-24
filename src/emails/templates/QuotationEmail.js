import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import ClientEmailLayout, { createClientEmailStyles } from '../layouts/ClientEmailLayout.js';
import { buildClientEmailBranding } from '../helpers/clientEmailBranding.js';
import { formatCurrency, formatDate } from '../formatters.js';

/**
 * @param {object} props
 * @param {string} props.customerName
 * @param {string} props.quotationNumber
 * @param {number|string} props.amount
 * @param {string} [props.currency='NGN']
 * @param {string|Date} props.validUntil
 * @param {string} props.quotationUrl
 * @param {string} props.businessName
 * @param {object} [props.branding]
 */
export default function QuotationEmail({
    customerName,
    quotationNumber,
    amount,
    currency = 'NGN',
    validUntil,
    quotationUrl,
    businessName,
    branding,
}) {
    const brand = branding || buildClientEmailBranding(null, businessName);
    const emailStyles = createClientEmailStyles(brand);
    const greetingName = customerName?.trim() || 'there';
    const hasValidUntil = Boolean(validUntil);
    const previewAmount = formatCurrency(amount, currency);
    const preview = hasValidUntil
        ? `Quotation ${quotationNumber} from ${brand.businessName} — ${previewAmount}, valid until ${formatDate(validUntil)}.`
        : `Quotation ${quotationNumber} from ${brand.businessName} — ${previewAmount}.`;

    const detailChildren = [
        React.createElement(Text, { style: emailStyles.detailLabel, key: 'qtn-label' }, 'Quotation number'),
        React.createElement(Text, { style: emailStyles.detailValue, key: 'qtn-value' }, quotationNumber),
        React.createElement(Text, { style: emailStyles.detailLabel, key: 'amt-label' }, 'Estimated total'),
        React.createElement(
            Text,
            { style: hasValidUntil ? emailStyles.detailValue : emailStyles.detailValueLast, key: 'amt-value' },
            previewAmount,
        ),
    ];
    if (hasValidUntil) {
        detailChildren.push(
            React.createElement(Text, { style: emailStyles.detailLabel, key: 'valid-label' }, 'Valid until'),
            React.createElement(Text, { style: emailStyles.detailValueLast, key: 'valid-value' }, formatDate(validUntil)),
        );
    }

    return React.createElement(
        ClientEmailLayout,
        {
            preview,
            branding: brand,
        },
        React.createElement(Text, { style: emailStyles.heading }, `Quotation from ${brand.businessName}`),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, you've received a quotation from ${brand.businessName}. Please review the estimate below.`,
        ),
        React.createElement(Section, { style: emailStyles.detailBox }, ...detailChildren),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: quotationUrl, style: emailStyles.button }, 'View quotation'),
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            'This quotation is not a demand for payment. Payment becomes due only after it has been accepted and converted into an invoice.',
        ),
    );
}
