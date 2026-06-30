import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { BRAND } from '../config.js';

/**
 * @param {object} props
 * @param {string} props.userName - Recipient display name
 * @param {string} props.dashboardUrl - Link to the Waraqah dashboard
 */
export default function WelcomeEmail({ userName, dashboardUrl }) {
    const greetingName = userName?.trim() || 'there';

    return React.createElement(
        EmailLayout,
        {
            preview: `Welcome to ${BRAND.name} — your invoicing workspace is ready.`,
        },
        React.createElement(Text, { style: emailStyles.heading }, `Welcome to ${BRAND.name}, ${greetingName}!`),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `We're glad you're here. ${BRAND.name} helps you create professional invoices, track payments, and grow your business — all in one place.`,
        ),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            'Get started by setting up your business profile, adding your first client, and sending your first invoice in minutes.',
        ),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: dashboardUrl, style: emailStyles.button }, 'Go to dashboard'),
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            'If you have questions, reply to this email or contact our support team anytime.',
        ),
    );
}
