import BusinessInfo from '../models/CompanyInfo.js';
import { PLANS, defaultBusinessInfoFields } from '../utils/businessInfoHelpers.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Extend premium by N months from the later of now or current premiumUntil */
export async function activatePremiumForUser(userId, { months = 1, subscription = null } = {}) {
    const extension = months * THIRTY_DAYS_MS;
    let info = await BusinessInfo.findOne({ userId });

    const base = info?.premiumUntil && new Date(info.premiumUntil) > new Date()
        ? new Date(info.premiumUntil)
        : new Date();
    const until = new Date(base.getTime() + extension);

    if (!info) {
        info = await BusinessInfo.create({
            userId,
            ...defaultBusinessInfoFields,
            plan: PLANS.PREMIUM,
            premiumUntil: until,
            subscriptionStatus: subscription ? 'active' : null,
            paystackSubscriptionCode: subscription?.subscriptionCode || '',
            paystackCustomerCode: subscription?.customerCode || '',
            paystackEmailToken: subscription?.emailToken || '',
        });
    } else {
        info.plan = PLANS.PREMIUM;
        info.premiumUntil = until;
        if (subscription) {
            info.subscriptionStatus = 'active';
            if (subscription.subscriptionCode) info.paystackSubscriptionCode = subscription.subscriptionCode;
            if (subscription.customerCode) info.paystackCustomerCode = subscription.customerCode;
            if (subscription.emailToken) info.paystackEmailToken = subscription.emailToken;
        }
        await info.save();
    }
    return info;
}

export async function deactivatePremiumSubscription(userId) {
    const info = await BusinessInfo.findOne({ userId });
    if (!info) return null;
    info.subscriptionStatus = 'cancelled';
    await info.save();
    return info;
}

export function isPremiumActive(doc) {
    if (!doc || doc.plan !== PLANS.PREMIUM) return false;
    if (!doc.premiumUntil) return true;
    return new Date(doc.premiumUntil) > new Date();
}
