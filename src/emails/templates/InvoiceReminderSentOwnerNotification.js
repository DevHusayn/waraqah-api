import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { formatCurrency, formatDate, formatDaysUntilDue } from '../formatters.js';

/**
 * Notifies the business owner that a payment reminder was sent to their client.
 *
 * @param {object} props
 * @param {string} props.ownerName - Business owner display name
 * @param {string} props.customerName - Client name
 * @param {string} props.clientEmail - Client email address
 * @param {string} props.invoiceNumber - Invoice number
 * @param {number|string} props.amountOutstanding - Outstanding amount
 * @param {string} [props.currency='NGN'] - Currency code
 * @param {string|Date} props.dueDate - Due date
 * @param {number} props.daysUntilDue - Days until due (negative if overdue)
 * @param {boolean} [props.automated=false] - Whether sent by scheduled automation
 * @param {string} props.invoiceDashboardUrl - Link to invoice in Waraqah dashboard
 */
export default function InvoiceReminderSentOwnerNotification({
    ownerName,
    customerName,
    clientEmail,
    invoiceNumber,
    amountOutstanding,
    currency = 'NGN',
    dueDate,
    daysUntilDue,
    automated = false,
    invoiceDashboardUrl,
}) {
    const greetingName = ownerName?.trim() || 'there';
    const dueLabel = formatDaysUntilDue(daysUntilDue);
    const intro = automated
        ? `Hi ${greetingName}, Waraqah automatically sent a payment reminder to your client for an upcoming or overdue invoice.`
        : `Hi ${greetingName}, you sent a payment reminder to your client. Here is a summary of what they received.`;

    return React.createElement(
        EmailLayout,
        {
            preview: `Payment reminder sent to ${customerName} for invoice ${invoiceNumber}.`,
        },
        React.createElement(Text, { style: emailStyles.heading }, 'Payment reminder sent'),
        React.createElement(Text, { style: emailStyles.paragraph }, intro),
        React.createElement(
            Section,
            { style: emailStyles.detailBox },
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Invoice number'),
            React.createElement(Text, { style: emailStyles.detailValue }, invoiceNumber),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Client'),
            React.createElement(Text, { style: emailStyles.detailValue }, customerName),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Sent to'),
            React.createElement(Text, { style: emailStyles.detailValue }, clientEmail),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Amount outstanding'),
            React.createElement(Text, { style: emailStyles.detailValue }, formatCurrency(amountOutstanding, currency)),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Due date'),
            React.createElement(Text, { style: emailStyles.detailValueLast }, `${formatDate(dueDate)} (${dueLabel})`),
        ),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: invoiceDashboardUrl, style: emailStyles.button }, 'View in dashboard'),
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            automated
                ? 'This reminder was sent by your daily payment reminder schedule.'
                : 'Your client received a separate email with a link to view and pay the invoice.',
        ),
    );
}
