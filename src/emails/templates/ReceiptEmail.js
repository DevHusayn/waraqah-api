import React from 'react';
import { Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { formatCurrency, formatDate } from '../formatters.js';

/**
 * @param {object} props
 * @param {string} props.customerName - Receipt recipient name
 * @param {string} props.receiptNumber - Receipt reference number
 * @param {number|string} props.amountPaid - Amount paid
 * @param {string} [props.currency='NGN'] - ISO currency code
 * @param {string|Date} props.paymentDate - Date payment was received
 * @param {string} props.businessName - Sender business name
 */
export default function ReceiptEmail({
    customerName,
    receiptNumber,
    amountPaid,
    currency = 'NGN',
    paymentDate,
    businessName,
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
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Receipt number'),
            React.createElement(Text, { style: emailStyles.detailValue }, receiptNumber),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Amount paid'),
            React.createElement(Text, { style: emailStyles.detailValue }, formatCurrency(amountPaid, currency)),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Payment date'),
            React.createElement(Text, { style: emailStyles.detailValueLast }, formatDate(paymentDate)),
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            'Please keep this email for your records. If you have any questions about this payment, contact the business directly.',
        ),
    );
}
