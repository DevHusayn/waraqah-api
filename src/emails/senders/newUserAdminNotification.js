import React from 'react';
import { sendEmail } from '../sendEmail.js';
import NewUserAdminNotification from '../templates/NewUserAdminNotification.js';

/**
 * Notify the platform admin that a new user signed up.
 */
export async function sendNewUserAdminNotification({
    to,
    userName,
    userEmail,
    businessName,
    signupMethod,
    signedUpAt,
    adminDashboardUrl,
}) {
    return sendEmail({
        to,
        subject: `New Waraqah signup: ${userEmail}`,
        type: 'admin-new-user',
        react: React.createElement(NewUserAdminNotification, {
            userName,
            userEmail,
            businessName,
            signupMethod,
            signedUpAt,
            adminDashboardUrl,
        }),
        text: [
            'A new account was created on Waraqah.',
            `Name: ${userName || '—'}`,
            `Email: ${userEmail}`,
            businessName ? `Business: ${businessName}` : null,
            `Sign-up method: ${signupMethod === 'google' ? 'Google' : 'Email & password'}`,
            `Admin: ${adminDashboardUrl}`,
        ].filter(Boolean).join('\n'),
    });
}
