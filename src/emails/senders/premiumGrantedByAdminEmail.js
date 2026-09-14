import React from 'react';
import { sendEmail } from '../sendEmail.js';
import PremiumGrantedByAdminEmail from '../templates/PremiumGrantedByAdminEmail.js';

export function buildPremiumGrantedByAdminText({ premiumUntil } = {}) {
    return [
        'A Waraqah admin has activated Premium on your account.',
        premiumUntil ? `Premium until: ${premiumUntil}` : null,
        'No payment was taken for this upgrade.',
    ].filter(Boolean).join('\n');
}

export async function sendPremiumGrantedByAdminEmail({ to, userName, premiumUntil }) {
    return sendEmail({
        to,
        subject: 'Premium has been activated on your Waraqah account',
        type: 'premium-granted-by-admin',
        react: React.createElement(PremiumGrantedByAdminEmail, { userName, premiumUntil }),
        text: buildPremiumGrantedByAdminText({ premiumUntil }),
    });
}
