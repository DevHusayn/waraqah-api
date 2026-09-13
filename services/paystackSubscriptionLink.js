import User from '../models/User.js';
import Payment from '../models/Payment.js';
import BusinessInfo from '../models/CompanyInfo.js';
import { activatePremiumForUser, isPremiumActive, linkPaystackSubscription } from './premiumActivation.js';
import {
    fetchCustomer,
    fetchSubscription,
    listSubscriptions,
    normalizeBillingInterval,
    getBillingConfig,
    verifyTransaction,
} from './paystack.js';

function monthsForInterval(interval) {
    return getBillingConfig(interval).months;
}

/** Extract Paystack subscription identifiers from a charge or verify payload. */
export function subscriptionMetaFromCharge(data) {
    if (!data) {
        return {
            subscriptionCode: '',
            customerCode: '',
            emailToken: '',
        };
    }

    const sub = data.subscription || data.authorization?.subscription_code;
    const subscriptionCode = typeof sub === 'string' ? sub : sub?.subscription_code || data.subscription_code || '';
    const customer = data.customer || {};

    return {
        subscriptionCode: String(subscriptionCode || '').trim(),
        customerCode: String(customer.customer_code || customer.id || '').trim(),
        emailToken: String(data.subscription?.email_token || data.email_token || '').trim(),
    };
}

export function needsSubscriptionLink(info) {
    if (!info) return true;
    return !String(info.paystackSubscriptionCode || '').trim() || info.subscriptionStatus !== 'active';
}

function normalizeSubscriptionList(result) {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.data)) return result.data;
    return [];
}

export function pickLatestActiveSubscription(subscriptions, billingInterval = null) {
    const normalized = normalizeSubscriptionList(subscriptions);
    const wanted = billingInterval === 'yearly'
        ? 'annually'
        : billingInterval === 'monthly'
            ? 'monthly'
            : '';
    const matching = wanted
        ? normalized.filter((sub) => {
            const planInterval = String(sub?.plan?.interval || sub?.interval || '').toLowerCase();
            return !planInterval || planInterval === wanted;
        })
        : normalized;
    const pool = matching.length > 0 ? matching : normalized;
    const active = pool.filter((sub) => {
        const status = String(sub?.status || '').toLowerCase();
        return status === 'active' || status === 'non-renewing';
    });
    if (active.length === 0) return null;
    return active.sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
    })[0];
}

async function findSubscriptionCodeForCustomer(customerCode, billingInterval) {
    if (!customerCode) return '';

    try {
        const listed = await listSubscriptions({ customer: customerCode });
        const match = pickLatestActiveSubscription(listed, billingInterval);
        return match?.subscription_code || match?.code || '';
    } catch (err) {
        console.error('[Paystack] listSubscriptions failed:', err.message);
        return '';
    }
}

async function findSubscriptionCodeForEmail(email, billingInterval) {
    if (!email) return '';

    try {
        const customer = await fetchCustomer(email.trim().toLowerCase());
        const customerCode = customer?.customer_code || customer?.id || '';
        return findSubscriptionCodeForCustomer(customerCode, billingInterval);
    } catch (err) {
        console.error('[Paystack] fetchCustomer failed:', err.message);
        return '';
    }
}

async function resolveSubscriptionCode({ userId, payment, paystackData, billingInterval }) {
    let meta = subscriptionMetaFromCharge(paystackData);

    if (!meta.subscriptionCode && payment?.paystackSubscriptionCode) {
        meta = {
            ...meta,
            subscriptionCode: payment.paystackSubscriptionCode,
        };
    }

    if (!meta.subscriptionCode && payment?.reference) {
        try {
            const verified = await verifyTransaction(payment.reference);
            meta = {
                ...subscriptionMetaFromCharge(verified),
                customerCode: meta.customerCode || subscriptionMetaFromCharge(verified).customerCode,
            };
            if (!paystackData) {
                paystackData = verified;
            }
        } catch (err) {
            console.error('[Paystack] verifyTransaction during subscription link failed:', err.message);
        }
    }

    if (!meta.subscriptionCode) {
        const info = await BusinessInfo.findOne({ userId });
        const customerCode = meta.customerCode || info?.paystackCustomerCode || paystackData?.customer?.customer_code;
        meta.subscriptionCode = await findSubscriptionCodeForCustomer(customerCode, billingInterval);
    }

    if (!meta.subscriptionCode && userId) {
        const user = await User.findById(userId).select('email').lean();
        meta.subscriptionCode = await findSubscriptionCodeForEmail(user?.email, billingInterval);
    }

    return { meta, paystackData };
}

async function buildSubscriptionPayload(subscriptionCode, partialMeta = {}) {
    let customerCode = partialMeta.customerCode || '';
    let emailToken = partialMeta.emailToken || '';

    try {
        const sub = await fetchSubscription(subscriptionCode);
        customerCode = sub?.customer?.customer_code || customerCode;
        emailToken = sub?.email_token || emailToken;
    } catch (err) {
        console.error('[Paystack] fetchSubscription failed:', err.message);
    }

    return {
        subscriptionCode,
        customerCode,
        emailToken,
    };
}

/**
 * Ensure a successful Paystack checkout is linked to BusinessInfo subscription fields.
 * Safe to call multiple times (verify retries, webhooks, repair).
 */
export async function ensurePaystackSubscriptionLinked({ userId, payment = null, paystackData = null }) {
    const info = await BusinessInfo.findOne({ userId });
    if (!needsSubscriptionLink(info)) {
        return info;
    }

    const billingInterval = normalizeBillingInterval(
        payment?.billingInterval
        || paystackData?.metadata?.interval
        || info?.billingInterval
        || 'monthly',
    );
    const months = monthsForInterval(billingInterval);

    const { meta } = await resolveSubscriptionCode({
        userId,
        payment,
        paystackData,
        billingInterval,
    });

    if (!meta.subscriptionCode) {
        if (payment?.status === 'success') {
            return activatePremiumForUser(userId, {
                months,
                billingInterval,
                subscription: null,
                fromPayment: true,
            });
        }
        return info;
    }

    const subscription = await buildSubscriptionPayload(meta.subscriptionCode, meta);

    if (payment) {
        payment.paystackSubscriptionCode = subscription.subscriptionCode;
        payment.type = 'subscription';
        if (payment.status !== 'success') {
            payment.status = 'success';
            payment.paidAt = payment.paidAt || new Date();
        }
        await payment.save();
    }

    if (isPremiumActive(info)) {
        return linkPaystackSubscription(userId, { subscription, billingInterval });
    }

    return activatePremiumForUser(userId, {
        months,
        billingInterval,
        subscription,
    });
}

/** Resolve userId for subscription.create when metadata is missing. */
export async function resolveUserIdForSubscriptionEvent(data, subscriptionCode) {
    const directUserId = data?.metadata?.userId || data?.customer?.metadata?.userId;
    if (directUserId) return String(directUserId);

    if (subscriptionCode) {
        const linkedPayment = await Payment.findOne({ paystackSubscriptionCode: subscriptionCode }).sort({ createdAt: -1 });
        if (linkedPayment?.userId) return String(linkedPayment.userId);
    }

    const email = data?.customer?.email;
    if (email) {
        const user = await User.findOne({ email: email.trim().toLowerCase() }).select('_id').lean();
        if (user?._id) return String(user._id);
    }

    return null;
}
