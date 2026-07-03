import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import ClientEmailLayout, { createClientEmailStyles } from '../layouts/ClientEmailLayout.js';
import { buildClientEmailBranding } from '../helpers/clientEmailBranding.js';
import { formatCurrency, formatDate } from '../formatters.js';

/**
 * @param {object} props
 * @param {string} props.customerName - Invoice recipient name
 * @param {string} props.invoiceNumber - Invoice reference number
 * @param {number|string} props.amount - Invoice total
 * @param {string} [props.currency='NGN'] - ISO currency code
 * @param {string|Date} props.dueDate - Payment due date
 * @param {string} props.invoiceUrl - Link to view/pay the invoice
 * @param {string} props.businessName - Sender business name
 * @param {object} [props.branding] - Business branding tokens
 */
export default function InvoiceEmail({
    customerName,
    invoiceNumber,
    amount,
    currency = 'NGN',
    dueDate,
    invoiceUrl,
    businessName,
    branding,
}) {
    const brand = branding || buildClientEmailBranding(null, businessName);
    const emailStyles = createClientEmailStyles(brand);
    const greetingName = customerName?.trim() || 'there';
    const hasDueDate = Boolean(dueDate);
    const previewAmount = formatCurrency(amount, currency);
    const preview = hasDueDate
        ? `Invoice ${invoiceNumber} from ${brand.businessName} — ${previewAmount} due ${formatDate(dueDate)}.`
        : `Invoice ${invoiceNumber} from ${brand.businessName} — ${previewAmount}.`;

    const detailChildren = [
        React.createElement(Text, { style: emailStyles.detailLabel, key: 'inv-label' }, 'Invoice number'),
        React.createElement(Text, { style: emailStyles.detailValue, key: 'inv-value' }, invoiceNumber),
        React.createElement(Text, { style: emailStyles.detailLabel, key: 'amt-label' }, 'Amount due'),
        React.createElement(
            Text,
            { style: hasDueDate ? emailStyles.detailValue : emailStyles.detailValueLast, key: 'amt-value' },
            previewAmount,
        ),
    ];
    if (hasDueDate) {
        detailChildren.push(
            React.createElement(Text, { style: emailStyles.detailLabel, key: 'due-label' }, 'Due date'),
            React.createElement(Text, { style: emailStyles.detailValueLast, key: 'due-value' }, formatDate(dueDate)),
        );
    }

    return React.createElement(
        ClientEmailLayout,
        {
            preview,
            branding: brand,
        },
        React.createElement(Text, { style: emailStyles.heading }, `Invoice from ${brand.businessName}`),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, you've received a new invoice from ${brand.businessName}. Please review the details below.`,
        ),
        React.createElement(Section, { style: emailStyles.detailBox }, ...detailChildren),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: invoiceUrl, style: emailStyles.button }, 'View invoice'),
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            'If you have already paid this invoice, please disregard this message.',
        ),
    );
}
