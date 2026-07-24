import React from 'react';
import { Button, Section, Text } from '@react-email/components';
import EmailLayout, { emailStyles } from '../layouts/EmailLayout.js';
import { formatDate } from '../formatters.js';

/**
 * @param {object} props
 * @param {string} props.userName
 * @param {string} props.userEmail
 * @param {string} [props.businessName]
 * @param {string} props.signupMethod - "email" | "google"
 * @param {Date|string} [props.signedUpAt]
 * @param {string} props.adminDashboardUrl
 */
export default function NewUserAdminNotification({
    userName,
    userEmail,
    businessName,
    signupMethod,
    signedUpAt,
    adminDashboardUrl,
}) {
    const methodLabel = signupMethod === 'google' ? 'Google' : 'Email & password';

    return React.createElement(
        EmailLayout,
        { preview: `New Waraqah signup: ${userEmail}` },
        React.createElement(Text, { style: emailStyles.heading }, 'New user signed up'),
        React.createElement(
            Text,
            { style: emailStyles.paragraph },
            'A new account was created on Waraqah. Summary below.',
        ),
        React.createElement(
            Section,
            { style: emailStyles.detailBox },
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Name'),
            React.createElement(Text, { style: emailStyles.detailValue }, userName?.trim() || '—'),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Email'),
            React.createElement(Text, { style: emailStyles.detailValue }, userEmail),
            businessName?.trim()
                ? React.createElement(
                      React.Fragment,
                      null,
                      React.createElement(Text, { style: emailStyles.detailLabel }, 'Business'),
                      React.createElement(Text, { style: emailStyles.detailValue }, businessName.trim()),
                  )
                : null,
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Sign-up method'),
            React.createElement(Text, { style: emailStyles.detailValue }, methodLabel),
            React.createElement(Text, { style: emailStyles.detailLabel }, 'Signed up'),
            React.createElement(Text, { style: emailStyles.detailValueLast }, formatDate(signedUpAt || new Date())),
        ),
        React.createElement(
            Section,
            { style: emailStyles.buttonSection },
            React.createElement(Button, { href: adminDashboardUrl, style: emailStyles.button }, 'Open admin dashboard'),
        ),
    );
}
