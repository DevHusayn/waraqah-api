import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { formatCurrency, formatDate } from '../formatters.js';

/**
 * @param {object} props
 * @param {string} props.customerName - Receipt recipient name
 * @param {string} [props.invoiceNumber] - Related invoice number
 * @param {string} props.receiptNumber - Receipt reference number
 * @param {number|string} props.amountPaid - Amount paid
 * @param {string} [props.currency='NGN'] - ISO currency code
 * @param {string|Date} props.paymentDate - Date payment was received
 * @param {string} [props.paymentMethod] - Optional payment method label
 * @param {string} props.businessName - Sender business name
 * @param {string} [props.receiptUrl] - Optional link to view receipt online
 */
export default function ReceiptEmail({
    customerName,
    invoiceNumber,
    receiptNumber,
    amountPaid,
    currency = 'NGN',
    paymentDate,
    paymentMethod,
    businessName,
    receiptUrl,
}) {
    const greetingName = customerName?.trim() || 'there';

    return React.createElement(
        EmailLayout,
        {
            preview: `Receipt ${receiptNumber} from ${businessName} — ${formatCurrency(amountPaid, currency)} paid on ${formatDate(paymentDate)}.`,
        },
        React.createElement(Text, { style: emailStyles.heading }, 'Payment receipt'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, thank you for your payment to ${businessName}. Here is your receipt for your records.`,
        ),
        React.createElement(
            Section,
            { style: emailStyles.detailBox },
            invoiceNumber
                ? React.createElement(
                    React.Fragment,
                    null,
                    React.createElement(Text, { style: emailStyles.detailLabel }, 'Invoice number'),
                    React.createElement(Text, { style: emailStyles.detailValue }, invoiceNumber),
                )
                : null,
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Receipt number'),
            React.createElement(Text, { style: emailStyles.detailValue }, receiptNumber),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Amount paid'),
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
        receiptUrl
            ? React.createElement(
                Section,
                { style: emailStyles.buttonSection },
                React.createElement(Button, { href: receiptUrl, style: emailStyles.button }, 'View receipt'),
            )
            : null,
        React.createElement(
            Text,
            { style: emailStyles.muted },
            'Please keep this email for your records. If you have any questions about this payment, contact the business directly.',
        ),
    );
}
