import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { formatCurrency, formatDate } from '../formatters.js';

export default function QuotationEmailedOwnerNotification({
    ownerName,
    customerName,
    clientEmail,
    quotationNumber,
    amount,
    currency = 'NGN',
    validUntil,
    quotationDashboardUrl,
}) {
    const greetingName = ownerName?.trim() || 'there';

    return React.createElement(
        EmailLayout,
        {
            preview: `Quotation ${quotationNumber} was emailed to ${customerName}.`,
        },
        React.createElement(Text, { style: emailStyles.heading }, 'Quotation sent to client'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, your quotation was successfully emailed to your client. Here is a quick summary.`,
        ),
        React.createElement(
            Section,
            { style: emailStyles.detailBox },
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Quotation number'),
            React.createElement(Text, { style: emailStyles.detailValue }, quotationNumber),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Client'),
            React.createElement(Text, { style: emailStyles.detailValue }, customerName),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Sent to'),
            React.createElement(Text, { style: emailStyles.detailValue }, clientEmail),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Estimated total'),
            React.createElement(Text, { style: emailStyles.detailValue }, formatCurrency(amount, currency)),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Valid until'),
            React.createElement(
                Text,
                { style: emailStyles.detailValueLast },
                validUntil ? formatDate(validUntil) : 'Not set',
            ),
        ),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(
                Button,
                { href: quotationDashboardUrl, style: emailStyles.button },
                'View in dashboard',
            ),
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            'Your client received a separate email with a link to view the quotation.',
        ),
    );
}
