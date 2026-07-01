import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { formatCurrency } from '../formatters.js';
import { getFrontendBaseUrl } from '../helpers/invoiceContext.js';

export default function PremiumUpgradeSuccessEmail({ userName, amount, currency = 'NGN', renewsAt }) {
    const greetingName = userName?.trim() || 'there';
    const settingsUrl = `${getFrontendBaseUrl()}/settings/plan-billing`;

    return React.createElement(
        EmailLayout,
        { preview: 'Welcome to Waraqah Premium — your subscription is active.' },
        React.createElement(Text, { style: emailStyles.heading }, 'Premium activated'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, thank you for upgrading to Waraqah Premium. Your subscription is now active.`,
        ),
        React.createElement(
            Section,
            { style: emailStyles.detailBox },
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Plan'),
            React.createElement(Text, { style: emailStyles.detailValue }, 'Waraqah Premium'),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Amount'),
            React.createElement(Text, { style: emailStyles.detailValueLast }, `${formatCurrency(amount, currency)}/month`),
            renewsAt
                ? React.createElement(
                    React.Fragment,
                    null,
                    React.createElement(Text, { style: { ...emailStyles.detailLabel, marginTop: '16px' } }, 'Renews on'),
                    React.createElement(Text, { style: emailStyles.detailValueLast }, renewsAt),
                )
                : null,
        ),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: settingsUrl, style: emailStyles.button }, 'Manage billing'),
        ),
    );
}
