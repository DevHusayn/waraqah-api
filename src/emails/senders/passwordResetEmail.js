import React from 'react';
import { sendEmail } from '../sendEmail.js';
import PasswordResetEmail from '../templates/PasswordResetEmail.js';
import { BRAND, PASSWORD_RESET_EXPIRY_MINUTES } from '../config.js';

/**
 * Send password reset email. Link should expire server-side after 15 minutes.
 *
 * @param {object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.resetUrl - Password reset URL with token
 */
export async function sendPasswordResetEmail({ to, resetUrl }) {
    const text = [
        `Reset your ${BRAND.name} password:`,
        '',
        resetUrl,
        '',
        `This link expires in ${PASSWORD_RESET_EXPIRY_MINUTES} minutes.`,
        'If you did not request this, ignore this email.',
    ].join('\n');

    return sendEmail({
        to,
        subject: `Reset your ${BRAND.name} password`,
        type: 'password-reset',
        text,
        react: React.createElement(PasswordResetEmail, { resetUrl }),
    });
}
