import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { getFrontendBaseUrl } from '../helpers/invoiceContext.js';

export default function PremiumSubscriptionCancelledEmail({ userName, premiumUntil }) {
    const greetingName = userName?.trim() || 'there';
    const billingUrl = `${getFrontendBaseUrl()}/settings/plan-billing`;

    return React.createElement(
        EmailLayout,
        { preview: 'Your Waraqah Premium auto-renewal has been cancelled.' },
        React.createElement(Text, { style: emailStyles.heading }, 'Premium auto-renewal cancelled'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, your Waraqah Premium subscription will no longer renew automatically.`,
        ),
        premiumUntil
            ? React.createElement(
                Text,
                { style: emailStyles.paragraph },
                `You keep Premium access until ${premiumUntil}. After that, your account returns to the free plan.`,
            )
            : React.createElement(
                Text,
                { style: emailStyles.paragraph },
                'Your account will return to the free plan at the end of the current billing period.',
            ),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: billingUrl, style: emailStyles.button }, 'View billing'),
        ),
    );
}
