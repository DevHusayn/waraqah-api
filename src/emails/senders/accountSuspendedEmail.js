import React from 'react';
import { sendEmail } from '../sendEmail.js';
import AccountSuspendedEmail from '../templates/AccountSuspendedEmail.js';

export async function sendAccountSuspendedEmail({ to, userName }) {
    return sendEmail({
        to,
        subject: 'Your Waraqah account has been suspended',
        type: 'account-suspended',
        react: React.createElement(AccountSuspendedEmail, { userName }),
        text: 'Your Waraqah account has been suspended. Contact support if you believe this is a mistake.',
    });
}
