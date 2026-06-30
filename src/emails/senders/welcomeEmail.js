import React from 'react';
import { sendEmail } from '../sendEmail.js';
import WelcomeEmail from '../templates/WelcomeEmail.js';
import { BRAND } from '../config.js';

/**
 * Send welcome email to a new user.
 *
 * @param {object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.userName - Display name
 * @param {string} params.dashboardUrl - Dashboard URL
 */
export async function sendWelcomeEmail({ to, userName, dashboardUrl }) {
    return sendEmail({
        to,
        subject: `Welcome to ${BRAND.name}`,
        type: 'welcome',
        react: React.createElement(WelcomeEmail, { userName, dashboardUrl }),
    });
}
