import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { getFrontendBaseUrl } from '../helpers/invoiceContext.js';
import { getSupportEmail } from '../config.js';

export default function PremiumGrantedByAdminEmail({ userName, premiumUntil }) {
    const greetingName = userName?.trim() || 'there';
    const settingsUrl = `${getFrontendBaseUrl()}/settings/plan-billing`;
    const supportEmail = getSupportEmail();

    return React.createElement(
        EmailLayout,
        { preview: 'Premium has been activated on your Waraqah account.' },
        React.createElement(Text, { style: emailStyles.heading }, 'Premium activated'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, a Waraqah admin has activated Premium on your account. You now have access to Premium features.`,
        ),
        premiumUntil
            ? React.createElement(
                Section,
                { style: emailStyles.detailBox },
                React.createElement(Text, { style: emailStyles.detailLabel }, 'Premium until'),
                React.createElement(Text, { style: emailStyles.detailValueLast }, premiumUntil),
            )
            : null,
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            'No payment was taken for this upgrade. You can review your plan anytime in settings.',
        ),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: settingsUrl, style: emailStyles.button }, 'View plan & billing'),
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            `If you did not expect this, contact us at ${supportEmail}.`,
        ),
    );
}
