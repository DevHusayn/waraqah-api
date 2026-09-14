import BusinessInfo from '../models/CompanyInfo.js';
import Payment from '../models/Payment.js';
import { PLANS, defaultBusinessInfoFields } from '../utils/businessInfoHelpers.js';
import { fetchSubscription, getBillingConfig, normalizeBillingInterval } from './paystack.js';

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const INFLATED_UNTIL_GRACE_MS = 24 * 60 * 60 * 1000;

export function parsePaystackDate(value) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function addCalendarMonths(date, months = 1) {
    const source = new Date(date);
    if (Number.isNaN(source.getTime())) return null;
    const periodMonths = Number(months) > 0 ? Number(months) : 1;
    const year = source.getUTCFullYear();
    const month = source.getUTCMonth();
    const day = source.getUTCDate();
    const result = new Date(Date.UTC(
        year,
        month + periodMonths,
        1,
        source.getUTCHours(),
        source.getUTCMinutes(),
        source.getUTCSeconds(),
        source.getUTCMilliseconds(),
    ));
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(day, lastDay));
    return result;
}

export function nextPaymentDateFromSubscription(sub) {
    if (!sub || typeof sub === 'string') return null;
    return parsePaystackDate(sub.next_payment_date || sub.nextPaymentDate || sub.next_payment);
}

export function premiumUntilFromPaidAt(paidAt, months = 1) {
    return addCalendarMonths(paidAt, months);
}
export function isPremiumUntilInflated(premiumUntil, paidAt, months = 1, graceMs = INFLATED_UNTIL_GRACE_MS) {
    const expected = premiumUntilFromPaidAt(paidAt, months);
    if (!expected || !premiumUntil) return false;
    return new Date(premiumUntil).getTime() > expected.getTime() + graceMs;
}

const RECENT_PAYMENT_MS = 45 * 24 * 60 * 60 * 1000;

/**
 * Decide a safe premiumUntil. Never moves a future date into the past.
 * Restores a paying subscriber if a bad clamp already expired them.
 */
export function nextReconciledPremiumUntil({
    plan,
    premiumUntil,
    billingInterval,
    paystackSubscriptionCode,
    paidAt,
    months = 1,
    now = new Date(),
    hasRecentCheckout = false,
    paystackNextPaymentDate = null,
} = {}) {
    if (plan !== PLANS.PREMIUM) return { until: premiumUntil, changed: false };

    const nowMs = new Date(now).getTime();
    const currentMs = premiumUntil ? new Date(premiumUntil).getTime() : 0;
    const paystackUntil = parsePaystackDate(paystackNextPaymentDate);
    if (paystackUntil && paystackUntil.getTime() > nowMs) {
        if (!currentMs || Math.abs(currentMs - paystackUntil.getTime()) > 60 * 1000) {
            return { until: paystackUntil, changed: true };
        }
        return { until: premiumUntil, changed: false };
    }

    const expected = paidAt ? premiumUntilFromPaidAt(paidAt, months) : null;
    const expectedMs = expected ? expected.getTime() : 0;
    const hasRecentSuccess = Boolean(paidAt) && (nowMs - new Date(paidAt).getTime() < RECENT_PAYMENT_MS);
    const isPaying = Boolean(billingInterval || paystackSubscriptionCode);

    if (currentMs && currentMs <= nowMs) {
        if (expectedMs > nowMs) {
            return { until: expected, changed: true };
        }
        if (isPaying && (hasRecentSuccess || hasRecentCheckout || paystackSubscriptionCode)) {
            return { until: addCalendarMonths(now, months), changed: true };
        }
        return { until: premiumUntil, changed: false };
    }

    if (!premiumUntil || !paidAt) {
        return { until: premiumUntil, changed: false };
    }

    // Paystack owns the renew date once a SUB_ code exists.
    if (paystackSubscriptionCode) {
        return { until: premiumUntil, changed: false };
    }

    if (expectedMs > nowMs && isPremiumUntilInflated(premiumUntil, paidAt, months)) {
        return { until: expected, changed: true };
    }

    return { until: premiumUntil, changed: false };
}
/** Reset stacked extra periods. Never expire a still-valid subscriber. */
export async function reconcilePremiumUntilForUser(userId) {
    const info = await BusinessInfo.findOne({ userId });
    if (!info) return info;

    const payment = await Payment.findOne({
        userId,
        status: 'success',
    }).sort({ paidAt: -1, createdAt: -1 });

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentCheckout = await Payment.findOne({
        userId,
        createdAt: { $gte: weekAgo },
    }).sort({ createdAt: -1 });

    const months = getBillingConfig(
        normalizeBillingInterval(payment?.billingInterval || info.billingInterval || 'monthly'),
    ).months;

    const { until, changed } = nextReconciledPremiumUntil({
        plan: info.plan,
        premiumUntil: info.premiumUntil,
        billingInterval: info.billingInterval,
        paystackSubscriptionCode: info.paystackSubscriptionCode,
        paidAt: payment?.paidAt,
        months,
        hasRecentCheckout: Boolean(recentCheckout),
    });

    if (!changed) return info;

    info.premiumUntil = until;
    await info.save();
    return info;
}

/** Pull next_payment_date from Paystack and store it as premiumUntil. */
export async function applyPaystackNextPaymentDate(info) {
    const code = String(info?.paystackSubscriptionCode || '').trim();
    if (!info || !code) return info;

    try {
        const sub = await fetchSubscription(code);
        const next = nextPaymentDateFromSubscription(sub);
        let dirty = false;
        if (sub?.email_token && !info.paystackEmailToken) {
            info.paystackEmailToken = sub.email_token;
            dirty = true;
        }
        const { until, changed } = nextReconciledPremiumUntil({
            plan: info.plan || PLANS.PREMIUM,
            premiumUntil: info.premiumUntil,
            billingInterval: info.billingInterval,
            paystackSubscriptionCode: code,
            paystackNextPaymentDate: next,
        });
        if (changed) {
            info.plan = PLANS.PREMIUM;
            info.premiumUntil = until;
            dirty = true;
        }
        if (dirty) await info.save();
        return info;
    } catch (err) {
        console.error('[Paystack] apply next_payment_date failed:', err.message);
        return info;
    }
}
/** Extend premium by N months from the later of now or current premiumUntil */
export async function activatePremiumForUser(
    userId,
    {
        months = 1,
        billingInterval = null,
        subscription = null,
        fromPayment = false,
        premiumUntil = null,
    } = {},
) {
    let info = await BusinessInfo.findOne({ userId });

    const fromPaystack = parsePaystackDate(premiumUntil || subscription?.nextPaymentDate);
    const until = fromPaystack
        || (fromPayment
            ? addCalendarMonths(new Date(), months)
            : addCalendarMonths(
                info?.premiumUntil && new Date(info.premiumUntil) > new Date()
                    ? info.premiumUntil
                    : new Date(),
                months,
            ));

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
            billingInterval: billingInterval || null,
        });
    } else {
        info.plan = PLANS.PREMIUM;
        info.premiumUntil = until;
        info.premiumExpiryReminderForUntil = null;
        if (billingInterval) info.billingInterval = billingInterval;
        if (subscription?.subscriptionCode) {
            info.subscriptionStatus = 'active';
            info.paystackSubscriptionCode = subscription.subscriptionCode;
            if (subscription.customerCode) info.paystackCustomerCode = subscription.customerCode;
            if (subscription.emailToken) info.paystackEmailToken = subscription.emailToken;
        } else if (
            fromPayment
            && (info.subscriptionStatus === 'cancelled' || info.subscriptionStatus === 'attention')
        ) {
            // Re-subscribe after cancel — restore access; Paystack sub code may link later via sync.
            info.subscriptionStatus = info.paystackSubscriptionCode ? 'active' : null;
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

/** Attach Paystack subscription metadata without changing premiumUntil. */
export async function linkPaystackSubscription(userId, { subscription, billingInterval = null } = {}) {
    if (!subscription?.subscriptionCode) {
        return BusinessInfo.findOne({ userId });
    }

    let info = await BusinessInfo.findOne({ userId });
    const nextUntil = parsePaystackDate(subscription.nextPaymentDate);
    if (!info) {
        info = await BusinessInfo.create({
            userId,
            ...defaultBusinessInfoFields,
            plan: PLANS.PREMIUM,
            premiumUntil: nextUntil && nextUntil.getTime() > Date.now() ? nextUntil : null,
            subscriptionStatus: 'active',
            paystackSubscriptionCode: subscription.subscriptionCode,
            paystackCustomerCode: subscription.customerCode || '',
            paystackEmailToken: subscription.emailToken || '',
            billingInterval: billingInterval || null,
        });
        return info;
    }

    info.plan = PLANS.PREMIUM;
    info.subscriptionStatus = 'active';
    info.paystackSubscriptionCode = subscription.subscriptionCode;
    if (subscription.customerCode) info.paystackCustomerCode = subscription.customerCode;
    if (subscription.emailToken) info.paystackEmailToken = subscription.emailToken;
    if (billingInterval) info.billingInterval = billingInterval;
    if (nextUntil && nextUntil.getTime() > Date.now()) {
        info.premiumUntil = nextUntil;
    }
    await info.save();
    return info;
}

export function isPremiumActive(doc) {
    if (!doc || doc.plan !== PLANS.PREMIUM) return false;
    if (!doc.premiumUntil) return true;
    return new Date(doc.premiumUntil) > new Date();
}
