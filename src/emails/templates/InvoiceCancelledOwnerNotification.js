import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { formatCurrency } from '../formatters.js';

export default function InvoiceCancelledOwnerNotification({
    ownerName,
    customerName,
    clientEmail,
    invoiceNumber,
    amount,
    currency = 'NGN',
    clientNotified,
    invoiceDashboardUrl,
}) {
    const greetingName = ownerName?.trim() || 'there';

    return React.createElement(
        EmailLayout,
        { preview: `Invoice ${invoiceNumber} was cancelled.` },
        React.createElement(Text, { style: emailStyles.heading }, 'Invoice cancelled'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, invoice ${invoiceNumber} has been marked as cancelled in Waraqah.`,
        ),
        React.createElement(
            Section,
            { style: emailStyles.detailBox },
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Invoice number'),
            React.createElement(Text, { style: emailStyles.detailValue }, invoiceNumber),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Client'),
            React.createElement(Text, { style: emailStyles.detailValue }, customerName || '—'),
            clientEmail
                ? React.createElement(
                      React.Fragment,
                      null,
                      React.createElement(Text, { style: emailStyles.detailLabel }, 'Client email'),
                      React.createElement(Text, { style: emailStyles.detailValue }, clientEmail),
                  )
                : null,
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Amount'),
            React.createElement(Text, { style: emailStyles.detailValueLast }, formatCurrency(amount, currency)),
        ),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: invoiceDashboardUrl, style: emailStyles.button }, 'View in dashboard'),
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            clientNotified
                ? 'Your client was notified by email that this invoice was cancelled.'
                : 'Your client was not emailed because no client email address is on file.',
        ),
    );
}
