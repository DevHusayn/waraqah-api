import React from 'react';
import { sendEmail } from '../sendEmail.js';
import EmailVerificationEmail from '../templates/EmailVerificationEmail.js';
import { BRAND } from '../config.js';

/**
 * Send email address verification link.
 *
 * @param {object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.userName - Display name
 * @param {string} params.verificationUrl - Verification URL with token
 */
export async function sendEmailVerificationEmail({ to, userName, verificationUrl }) {
    const text = [
        `Verify your ${BRAND.name} email address:`,
        '',
        verificationUrl,
        '',
        'If you did not create an account, ignore this email.',
    ].join('\n');

    return sendEmail({
        to,
        subject: `Verify your ${BRAND.name} email`,
        type: 'email-verification',
        text,
        react: React.createElement(EmailVerificationEmail, { userName, verificationUrl }),
    });
}
