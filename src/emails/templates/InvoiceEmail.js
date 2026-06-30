import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
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
 */
export default function InvoiceEmail({
    customerName,
    invoiceNumber,
    amount,
    currency = 'NGN',
    dueDate,
    invoiceUrl,
    businessName,
}) {
    const greetingName = customerName?.trim() || 'there';

    return React.createElement(
        EmailLayout,
        {
            preview: `Invoice ${invoiceNumber} from ${businessName} — ${formatCurrency(amount, currency)} due ${formatDate(dueDate)}.`,
        },
        React.createElement(Text, { style: emailStyles.heading }, `Invoice from ${businessName}`),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, you've received a new invoice from ${businessName}. Please review the details below.`,
        ),
        React.createElement(
            Section,
            { style: emailStyles.detailBox },
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Invoice number'),
            React.createElement(Text, { style: emailStyles.detailValue }, invoiceNumber),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Amount due'),
            React.createElement(Text, { style: emailStyles.detailValue }, formatCurrency(amount, currency)),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Due date'),
            React.createElement(Text, { style: emailStyles.detailValueLast }, formatDate(dueDate)),
        ),
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
