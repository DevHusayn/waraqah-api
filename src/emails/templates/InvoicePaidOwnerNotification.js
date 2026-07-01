import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { formatCurrency, formatDate } from '../formatters.js';

/**
 * Notifies the business owner that an invoice was marked as paid.
 *
 * @param {object} props
 * @param {string} props.ownerName - Business owner display name
 * @param {string} props.customerName - Client name
 * @param {string} props.invoiceNumber - Invoice number
 * @param {string} [props.receiptNumber] - Receipt number
 * @param {number|string} props.amountPaid - Amount paid
 * @param {string} [props.currency='NGN'] - Currency code
 * @param {string|Date} props.paymentDate - Payment date
 * @param {string} [props.paymentMethod] - Payment method label
 * @param {string} props.invoiceDashboardUrl - Link to invoice in Waraqah dashboard
 */
export default function InvoicePaidOwnerNotification({
    ownerName,
    customerName,
    invoiceNumber,
    receiptNumber,
    amountPaid,
    currency = 'NGN',
    paymentDate,
    paymentMethod,
    invoiceDashboardUrl,
}) {
    const greetingName = ownerName?.trim() || 'there';

    return React.createElement(
        EmailLayout,
        {
            preview: `Payment received — ${formatCurrency(amountPaid, currency)} for invoice ${invoiceNumber}.`,
        },
        React.createElement(Text, { style: emailStyles.heading }, 'Payment received'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, great news — invoice ${invoiceNumber} from ${customerName || 'your client'} has been marked as paid.`,
        ),
        React.createElement(
            Section,
            { style: emailStyles.detailBox },
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Invoice number'),
            React.createElement(Text, { style: emailStyles.detailValue }, invoiceNumber),
            receiptNumber
                ? React.createElement(
                    React.Fragment,
                    null,
                    React.createElement(Text, { style: emailStyles.detailLabel }, 'Receipt number'),
                    React.createElement(Text, { style: emailStyles.detailValue }, receiptNumber),
                )
                : null,
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Amount received'),
            React.createElement(Text, { style: emailStyles.detailValue }, formatCurrency(amountPaid, currency)),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Payment date'),
            React.createElement(Text, { style: emailStyles.detailValueLast }, formatDate(paymentDate)),
            paymentMethod
                ? React.createElement(
                    React.Fragment,
                    null,
                    React.createElement(Text, { style: { ...emailStyles.detailLabel, marginTop: '16px' } }, 'Payment method'),
                    React.createElement(Text, { style: emailStyles.detailValueLast }, paymentMethod),
                )
                : null,
        ),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: invoiceDashboardUrl, style: emailStyles.button }, 'View invoice'),
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            'Your client also received payment confirmation and receipt emails if their email is on file.',
        ),
    );
}
