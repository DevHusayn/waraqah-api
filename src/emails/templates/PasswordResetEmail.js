import React from 'react';
import { Button, Link, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { BRAND, PASSWORD_RESET_EXPIRY_MINUTES } from '../config.js';

/**
 * @param {object} props
 * @param {string} props.resetUrl - Password reset link (expires in 15 minutes)
 */
export default function PasswordResetEmail({ resetUrl }) {
    return React.createElement(
        EmailLayout,
        {
            preview: `Reset your ${BRAND.name} password — link expires in ${PASSWORD_RESET_EXPIRY_MINUTES} minutes.`,
        },
        React.createElement(Text, { style: emailStyles.heading }, 'Reset your password'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            `We received a request to reset the password for your ${BRAND.name} account. Click the button below to choose a new password.`,
        ),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: resetUrl, style: emailStyles.button }, 'Reset password'),
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            `This link expires in ${PASSWORD_RESET_EXPIRY_MINUTES} minutes. If you did not request a password reset, you can safely ignore this email — your password will not change.`,
        ),
        React.createElement(
            Text,
            { style: emailStyles.muted },
            'Or copy and paste this link into your browser: ',
            React.createElement(Link, { href: resetUrl, style: emailStyles.link }, resetUrl),
        ),
    );
}
