import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { formatCurrency } from '../formatters.js';
import { getFrontendBaseUrl } from '../helpers/invoiceContext.js';

export default function PremiumPaymentFailedEmail({ userName, amount, currency = 'NGN' }) {
    const greetingName = userName?.trim() || 'there';
    const billingUrl = `${getFrontendBaseUrl()}/settings/plan-billing`;

    return React.createElement(
        EmailLayout,
        { preview: 'Your Waraqah Premium payment could not be processed.' },
        React.createElement(Text, { style: emailStyles.heading }, 'Premium payment failed'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, we could not process your latest Waraqah Premium payment of ${formatCurrency(amount, currency)}.`,
        ),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            'Please update your payment method or retry checkout to keep Premium features active.',
        ),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: billingUrl, style: emailStyles.button }, 'Update billing'),
        ),
    );
}
