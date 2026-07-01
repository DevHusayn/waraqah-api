import React from 'react';
import { Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { getSupportEmail } from '../config.js';

export default function AccountSuspendedEmail({ userName }) {
    const greetingName = userName?.trim() || 'there';
    const supportEmail = getSupportEmail();

    return React.createElement(
        EmailLayout,
        { preview: 'Your Waraqah account has been suspended.' },
        React.createElement(Text, { style: emailStyles.heading }, 'Account suspended'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, your Waraqah account has been suspended and you can no longer sign in or access your workspace.`,
        ),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `If you believe this is a mistake, contact us at ${supportEmail} and our team will review your account.`,
        ),
    );
}
