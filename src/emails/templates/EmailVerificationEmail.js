import React from 'react';
import { Button, Link, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { BRAND } from '../config.js';

/**
 * @param {object} props
 * @param {string} props.userName - Recipient display name
 * @param {string} props.verificationUrl - Email verification link
 */
export default function EmailVerificationEmail({ userName, verificationUrl }) {
    const greetingName = userName?.trim() || 'there';

    return React.createElement(
        EmailLayout,
        {
            preview: `Verify your email to activate your ${BRAND.name} account.`,
        },
        React.createElement(Text, { style: emailStyles.heading }, 'Verify your email address'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `Hi ${greetingName}, thanks for signing up for ${BRAND.name}. Please confirm your email address to secure your account and unlock all features.`,
        ),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: verificationUrl, style: emailStyles.button }, 'Verify email address'),
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            'If you did not create a Waraqah account, you can ignore this email.',
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            'Or copy and paste this link into your browser: ',
            React.createElement(Link, { href: verificationUrl, style: emailStyles.link }, verificationUrl),
        ),
    );
}
