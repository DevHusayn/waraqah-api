import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import ClientEmailLayout, { createClientEmailStyles } from '../layouts/ClientEmailLayout.js';
import { buildClientEmailBranding } from '../helpers/clientEmailBranding.js';
import { formatCurrency, formatDate } from '../formatters.js';

/**
 * @param {object} props
 * @param {string} props.customerName - Customer name
 * @param {string} props.invoiceNumber - Related invoice number
 * @param {number|string} props.amountPaid - Amount successfully paid
 * @param {string} [props.currency='NGN'] - ISO currency code
 * @param {string|Date} props.paymentDate - Date of successful payment
 * @param {string} [props.paymentMethod] - Optional payment method label
 * @param {string} props.businessName - Sender business name
 * @param {string} [props.receiptUrl] - Optional link to view receipt
 * @param {object} [props.branding] - Business branding tokens
 */
export default function PaymentConfirmationEmail({
    customerName,
    invoiceNumber,
    amountPaid,
    currency = 'NGN',
    paymentDate,
    paymentMethod,
    businessName,
    receiptUrl,
    branding,
}) {
    const brand = branding || buildClientEmailBranding(null, businessName);
    const emailStyles = createClientEmailStyles(brand);
    const greetingName = customerName?.trim() || 'there';

    return React.createElement(
        ClientEmailLayout,
        {
            preview: `Payment confirmed for invoice ${invoiceNumber} — ${formatCurrency(amountPaid, currency)}.`,
            branding: brand,
        },
        React.createElement(Text, { style: emailStyles.heading }, 'Payment confirmed'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, your payment to ${brand.businessName} was successful. Thank you!`,
        ),
        React.createElement(
            Section,
            { style: emailStyles.detailBox },
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Invoice number'),
            React.createElement(Text, { style: emailStyles.detailValue }, invoiceNumber),
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
            'This email confirms that your payment has been processed. No further action is required.',
        ),
    );
}
