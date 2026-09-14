import User from '../../../models/User.js';
import BusinessInfo from '../../../models/CompanyInfo.js';
import { sendPremiumUpgradeSuccessEmail } from '../senders/premiumUpgradeSuccessEmail.js';
import { sendPremiumPaymentFailedEmail } from '../senders/premiumPaymentFailedEmail.js';
import { sendPremiumSubscriptionCancelledEmail } from '../senders/premiumSubscriptionCancelledEmail.js';
import { sendPremiumGrantedByAdminEmail } from '../senders/premiumGrantedByAdminEmail.js';
import { sendAccountSuspendedEmail } from '../senders/accountSuspendedEmail.js';
import { sendAccountReactivatedEmail } from '../senders/accountReactivatedEmail.js';
import { getFrontendBaseUrl } from './invoiceContext.js';
import { PREMIUM_AMOUNT_NGN, PREMIUM_YEARLY_AMOUNT_NGN, getBillingConfig, normalizeBillingInterval } from '../../../services/paystack.js';

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

export async function notifyPremiumUpgradeSuccess(userId, { billingInterval = 'monthly' } = {}) {
    try {
        const ctx = await loadUserContext(userId);
        if (!ctx) return;
        const interval = normalizeBillingInterval(billingInterval);
        const amount = getBillingConfig(interval).amountNgn;
        await sendPremiumUpgradeSuccessEmail({
            to: ctx.to,
            userName: ctx.userName,
            amount,
            currency: 'NGN',
            billingInterval: interval,
            renewsAt: formatDateLabel(ctx.premiumUntil),
        });
    } catch (err) {
        logFailure('Premium upgrade success', err);
    }
}

export async function notifyPremiumPaymentFailed(userId) {
    try {
        const ctx = await loadUserContext(userId);
        if (!ctx) return;
        await sendPremiumPaymentFailedEmail({
            to: ctx.to,
            userName: ctx.userName,
            amount: PREMIUM_AMOUNT_NGN,
            currency: 'NGN',
        });
    } catch (err) {
        logFailure('Premium payment failed', err);
    }
}

export async function notifyPremiumGrantedByAdmin(userId) {
    try {
        const ctx = await loadUserContext(userId);
        if (!ctx) return;
        await sendPremiumGrantedByAdminEmail({
            to: ctx.to,
            userName: ctx.userName,
            premiumUntil: formatDateLabel(ctx.premiumUntil),
        });
    } catch (err) {
        logFailure('Premium granted by admin', err);
    }
}

export async function notifyPremiumSubscriptionCancelled(userId, { billingInterval = 'monthly' } = {}) {
    try {
        const ctx = await loadUserContext(userId);
        if (!ctx) return;
        await sendPremiumSubscriptionCancelledEmail({
            to: ctx.to,
            userName: ctx.userName,
            premiumUntil: formatDateLabel(ctx.premiumUntil),
            billingInterval: normalizeBillingInterval(billingInterval),
        });
    } catch (err) {
        logFailure('Premium subscription cancelled', err);
    }
}

export async function notifyAccountSuspended(user) {
    try {
        if (!user?.email?.trim()) return;
        await sendAccountSuspendedEmail({
            to: user.email.trim().toLowerCase(),
            userName: user.name,
        });
    } catch (err) {
        logFailure('Account suspended', err);
    }
}

export async function notifyAccountReactivated(user) {
    try {
        if (!user?.email?.trim()) return;
        await sendAccountReactivatedEmail({
            to: user.email.trim().toLowerCase(),
            userName: user.name,
            dashboardUrl: getFrontendBaseUrl(),
        });
    } catch (err) {
        logFailure('Account reactivated', err);
    }
}
