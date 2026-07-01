import React from 'react';
import { sendEmail } from '../sendEmail.js';
import PremiumSubscriptionCancelledEmail from '../templates/PremiumSubscriptionCancelledEmail.js';

export async function sendPremiumSubscriptionCancelledEmail({ to, userName, premiumUntil }) {
    return sendEmail({
        to,
        subject: 'Waraqah Premium auto-renewal cancelled',
        type: 'premium-subscription-cancelled',
        react: React.createElement(PremiumSubscriptionCancelledEmail, { userName, premiumUntil }),
        text: premiumUntil
            ? `Premium auto-renewal cancelled. Access continues until ${premiumUntil}.`
            : 'Premium auto-renewal cancelled.',
    });
}
