import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { formatCurrency, formatDate } from '../formatters.js';

/**
 * Notifies the business owner that an invoice was emailed to their client.
 *
 * @param {object} props
 * @param {string} props.ownerName - Business owner display name
 * @param {string} props.customerName - Client name
 * @param {string} props.clientEmail - Client email address
 * @param {string} props.invoiceNumber - Invoice number
 * @param {number|string} props.amount - Invoice total
 * @param {string} [props.currency='NGN'] - Currency code
 * @param {string|Date} props.dueDate - Due date
 * @param {string} props.invoiceDashboardUrl - Link to invoice in Waraqah dashboard
 */
export default function InvoiceEmailedOwnerNotification({
    ownerName,
    customerName,
    clientEmail,
    invoiceNumber,
    amount,
    currency = 'NGN',
    dueDate,
    invoiceDashboardUrl,
}) {
    const greetingName = ownerName?.trim() || 'there';

    return React.createElement(
        EmailLayout,
        {
            preview: `Invoice ${invoiceNumber} was emailed to ${customerName}.`,
        },
        React.createElement(Text, { style: emailStyles.heading }, 'Invoice sent to client'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, your invoice was successfully emailed to your client. Here is a quick summary.`,
        ),
        React.createElement(
            Section,
            { style: emailStyles.detailBox },
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Invoice number'),
            React.createElement(Text, { style: emailStyles.detailValue }, invoiceNumber),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Client'),
            React.createElement(Text, { style: emailStyles.detailValue }, customerName),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Sent to'),
            React.createElement(Text, { style: emailStyles.detailValue }, clientEmail),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Amount'),
            React.createElement(Text, { style: emailStyles.detailValue }, formatCurrency(amount, currency)),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Due date'),
            React.createElement(Text, { style: emailStyles.detailValueLast }, formatDate(dueDate)),
        ),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: invoiceDashboardUrl, style: emailStyles.button }, 'View in dashboard'),
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            'Your client received a separate email with a link to view and pay the invoice.',
        ),
    );
}
