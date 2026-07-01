import User from '../../../models/User.js';
import BusinessInfo from '../../../models/CompanyInfo.js';
import { sendPremiumUpgradeSuccessEmail } from '../senders/premiumUpgradeSuccessEmail.js';
import { sendPremiumPaymentFailedEmail } from '../senders/premiumPaymentFailedEmail.js';
import { sendPremiumSubscriptionCancelledEmail } from '../senders/premiumSubscriptionCancelledEmail.js';
import { sendAccountSuspendedEmail } from '../senders/accountSuspendedEmail.js';
import { PREMIUM_AMOUNT_NGN } from '../../../services/paystack.js';

function logFailure(type, err) {
    console.error(`[Waraqah Email] ${type} failed:`, err?.message || err);
}

async function loadUserContext(userId) {
    const [user, info] = await Promise.all([
        User.findById(userId),
        BusinessInfo.findOne({ userId }),
    ]);
    if (!user?.email?.trim()) return null;
    return {
        to: user.email.trim().toLowerCase(),
        userName: user.name?.trim() || info?.name?.trim() || 'there',
        premiumUntil: info?.premiumUntil,
    };
}

function formatDateLabel(date) {
    if (!date) return null;
    return new Date(date).toLocaleDateString('en-NG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

export function notifyPremiumUpgradeSuccess(userId) {
    Promise.resolve()
        .then(async () => {
            const ctx = await loadUserContext(userId);
            if (!ctx) return;
            await sendPremiumUpgradeSuccessEmail({
                to: ctx.to,
                userName: ctx.userName,
                amount: PREMIUM_AMOUNT_NGN,
                currency: 'NGN',
                renewsAt: formatDateLabel(ctx.premiumUntil),
            });
        })
        .catch((err) => logFailure('Premium upgrade success', err));
}

export function notifyPremiumPaymentFailed(userId) {
    Promise.resolve()
        .then(async () => {
            const ctx = await loadUserContext(userId);
            if (!ctx) return;
            await sendPremiumPaymentFailedEmail({
                to: ctx.to,
                userName: ctx.userName,
                amount: PREMIUM_AMOUNT_NGN,
                currency: 'NGN',
            });
        })
        .catch((err) => logFailure('Premium payment failed', err));
}

export function notifyPremiumSubscriptionCancelled(userId) {
    Promise.resolve()
        .then(async () => {
            const ctx = await loadUserContext(userId);
            if (!ctx) return;
            await sendPremiumSubscriptionCancelledEmail({
                to: ctx.to,
                userName: ctx.userName,
                premiumUntil: formatDateLabel(ctx.premiumUntil),
            });
        })
        .catch((err) => logFailure('Premium subscription cancelled', err));
}

export function notifyAccountSuspended(user) {
    Promise.resolve()
        .then(async () => {
            if (!user?.email?.trim()) return;
            await sendAccountSuspendedEmail({
                to: user.email.trim().toLowerCase(),
                userName: user.name,
            });
        })
        .catch((err) => logFailure('Account suspended', err));
}
