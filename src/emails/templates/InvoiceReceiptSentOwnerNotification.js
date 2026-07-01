import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { formatCurrency, formatDate } from '../formatters.js';

export default function InvoiceReceiptSentOwnerNotification({
    ownerName,
    customerName,
    clientEmail,
    receiptNumber,
    invoiceNumber,
    amountPaid,
    currency = 'NGN',
    paymentDate,
    invoiceDashboardUrl,
}) {
    const greetingName = ownerName?.trim() || 'there';

    return React.createElement(
        EmailLayout,
        { preview: `Receipt ${receiptNumber} was emailed to ${customerName}.` },
        React.createElement(Text, { style: emailStyles.heading }, 'Receipt sent to client'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, a receipt copy was emailed to your client.`,
        ),
        React.createElement(
            Section,
            { style: emailStyles.detailBox },
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Receipt number'),
            React.createElement(Text, { style: emailStyles.detailValue }, receiptNumber),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Invoice number'),
            React.createElement(Text, { style: emailStyles.detailValue }, invoiceNumber),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Client'),
            React.createElement(Text, { style: emailStyles.detailValue }, customerName),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Sent to'),
            React.createElement(Text, { style: emailStyles.detailValue }, clientEmail),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Amount paid'),
            React.createElement(Text, { style: emailStyles.detailValueLast }, formatCurrency(amountPaid, currency)),
        ),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: invoiceDashboardUrl, style: emailStyles.button }, 'View in dashboard'),
        ),
    );
}
