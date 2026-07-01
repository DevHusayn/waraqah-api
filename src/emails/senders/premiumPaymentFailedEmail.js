import React from 'react';
import { sendEmail } from '../sendEmail.js';
import PremiumPaymentFailedEmail from '../templates/PremiumPaymentFailedEmail.js';
import { formatCurrency } from '../formatters.js';

export async function sendPremiumPaymentFailedEmail({ to, userName, amount, currency = 'NGN' }) {
    return sendEmail({
        to,
        subject: 'Waraqah Premium payment failed',
        type: 'premium-payment-failed',
        react: React.createElement(PremiumPaymentFailedEmail, { userName, amount, currency }),
        text: `Your Waraqah Premium payment of ${formatCurrency(amount, currency)} could not be processed. Update billing in Settings.`,
    });
}
