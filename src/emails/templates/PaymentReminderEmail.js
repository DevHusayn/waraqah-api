import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import ClientEmailLayout, { createClientEmailStyles } from '../layouts/ClientEmailLayout.js';
import { buildClientEmailBranding } from '../helpers/clientEmailBranding.js';
import { formatCurrency, formatDate, formatDaysUntilDue } from '../formatters.js';

/**
 * @param {object} props
 * @param {string} props.customerName - Customer name
 * @param {string} props.invoiceNumber - Invoice reference number
 * @param {number|string} props.amountOutstanding - Outstanding balance
 * @param {string} [props.currency='NGN'] - ISO currency code
 * @param {string|Date} props.dueDate - Payment due date
 * @param {number} props.daysUntilDue - Days remaining until due (0 = due today)
 * @param {string} props.invoiceUrl - Link to view/pay the invoice
 * @param {string} props.businessName - Sender business name
 * @param {object} [props.branding] - Business branding tokens
 */
export default function PaymentReminderEmail({
    customerName,
    invoiceNumber,
    amountOutstanding,
    currency = 'NGN',
    dueDate,
    daysUntilDue,
    invoiceUrl,
    businessName,
    branding,
}) {
    const brand = branding || buildClientEmailBranding(null, businessName);
    const emailStyles = createClientEmailStyles(brand);
    const greetingName = customerName?.trim() || 'there';
    const dueLabel = formatDaysUntilDue(daysUntilDue);
    const isOverdue = Number(daysUntilDue) < 0;
    const urgencyText = isOverdue
        ? 'This invoice is overdue. Please complete payment as soon as possible.'
        : `Payment is due in ${dueLabel}.`;

    return React.createElement(
        ClientEmailLayout,
        {
            preview: `Reminder: invoice ${invoiceNumber} — ${formatCurrency(amountOutstanding, currency)} outstanding, due ${formatDate(dueDate)}.`,
            branding: brand,
        },
        React.createElement(Text, { style: emailStyles.heading }, 'Payment reminder'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, this is a friendly reminder from ${brand.businessName} about an outstanding invoice.`,
        ),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            urgencyText,
        ),
        React.createElement(
            Section,
            { style: emailStyles.detailBox },
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Invoice number'),
            React.createElement(Text, { style: emailStyles.detailValue }, invoiceNumber),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Amount outstanding'),
            React.createElement(Text, { style: emailStyles.detailValue }, formatCurrency(amountOutstanding, currency)),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Due date'),
            React.createElement(Text, { style: emailStyles.detailValueLast }, formatDate(dueDate)),
        ),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: invoiceUrl, style: emailStyles.button }, 'Pay now'),
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            'If you have already sent payment, please disregard this reminder. Thank you for your business.',
        ),
    );
}
