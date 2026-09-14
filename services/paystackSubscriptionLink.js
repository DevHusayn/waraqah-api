import User from '../models/User.js';
import Payment from '../models/Payment.js';
import BusinessInfo from '../models/CompanyInfo.js';
import {
    activatePremiumForUser,
    applyPaystackNextPaymentDate,
    isPremiumActive,
    linkPaystackSubscription,
    nextPaymentDateFromSubscription,
    reconcilePremiumUntilForUser,
} from './premiumActivation.js';
import { expireAbandonedCheckouts } from './billingHistory.js';
import {
    fetchCustomer,
    fetchSubscription,
    listSubscriptions,
    listTransactions,
    normalizeBillingInterval,
    getBillingConfig,
    verifyTransaction,
    PREMIUM_AMOUNT_KOBO,
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
            nextPaymentDate: null,
        };
    }

    const sub = data.subscription || data.authorization?.subscription_code;
    const subscriptionCode = typeof sub === 'string' ? sub : sub?.subscription_code || data.subscription_code || '';
    const customer = data.customer || {};

    return {
        subscriptionCode: String(subscriptionCode || '').trim(),
        customerCode: String(customer.customer_code || customer.id || '').trim(),
        emailToken: String(data.subscription?.email_token || data.email_token || '').trim(),
        nextPaymentDate: nextPaymentDateFromSubscription(typeof sub === 'object' ? sub : data),
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

export function subscriptionCustomerEmail(sub) {
    return String(sub?.customer?.email || '').trim().toLowerCase();
}

async function findSubscriptionByEmailScan(email, billingInterval) {
    const wanted = email.trim().toLowerCase();
    if (!wanted) return null;

    for (let page = 1; page <= 10; page += 1) {
        const listed = await listSubscriptions({ page, perPage: 50 });
        const rows = normalizeSubscriptionList(listed);
        const forEmail = rows.filter((sub) => subscriptionCustomerEmail(sub) === wanted);
        const match = pickLatestActiveSubscription(forEmail, billingInterval)
            || pickLatestActiveSubscription(forEmail);
        if (match) return match;
        if (rows.length < 50) break;
    }
    return null;
}

async function findSubscriptionCodeForEmail(email, billingInterval) {
    if (!email) return '';
    const normalized = email.trim().toLowerCase();

    try {
        const customer = await fetchCustomer(normalized);
        const customerCode = customer?.customer_code || customer?.id || '';
        const fromCustomer = await findSubscriptionCodeForCustomer(customerCode, billingInterval);
        if (fromCustomer) return fromCustomer;
    } catch {
        /* Email lookup often 404s; scan subscriptions next. */
    }

    try {
        const match = await findSubscriptionByEmailScan(normalized, billingInterval);
        return match?.subscription_code || match?.code || '';
    } catch (err) {
        console.error('[Paystack] subscription email scan failed:', err.message);
        return '';
    }
}

async function upsertSuccessPaymentFromTransaction(userId, tx, { subscriptionCode, billingInterval }) {
    if (!tx?.reference) return null;

    const already = await Payment.findOne({ reference: tx.reference });
    if (already) {
        already.userId = already.userId || userId;
        already.paystackSubscriptionCode = already.paystackSubscriptionCode || subscriptionCode;
        already.status = 'success';
        already.type = already.type || 'subscription';
        already.billingInterval = already.billingInterval || billingInterval;
        already.channel = already.channel || tx.channel || '';
        already.paidAt = already.paidAt || (tx.paid_at ? new Date(tx.paid_at) : new Date());
        if (tx.amount && !already.amount) already.amount = tx.amount;
        await already.save();
        return already;
    }

    return Payment.create({
        userId,
        reference: tx.reference,
        amount: tx.amount || PREMIUM_AMOUNT_KOBO,
        currency: (tx.currency || 'NGN').toUpperCase(),
        status: 'success',
        type: 'subscription',
        billingInterval,
        channel: tx.channel || '',
        paidAt: tx.paid_at ? new Date(tx.paid_at) : new Date(),
        paystackSubscriptionCode: subscriptionCode,
    });
}

/** Import Paystack success charges even when the subscription is already linked. */
export async function backfillPaymentsFromSubscription(userId, subscription, billingInterval) {
    const subCode = subscription?.subscriptionCode;
    if (!userId || !subCode) return [];

    const interval = normalizeBillingInterval(billingInterval || 'monthly');
    let rows = successTransactionsFromSubscription(subscription);
    const customerLookup = subscription.customerId || subscription.customerCode;
    if (customerLookup) {
        try {
            const listed = await listTransactions({
                customer: customerLookup,
                status: 'success',
                perPage: 50,
            });
            rows = [...rows, ...normalizeSubscriptionList(listed)];
        } catch (err) {
            console.error('[Paystack] listTransactions failed:', err.message);
        }
    }

    const seen = new Set();
    const successes = rows.filter((row) => {
        const reference = String(row?.reference || '').trim();
        const status = String(row.status || 'success').toLowerCase();
        if (!reference || seen.has(reference)) return false;
        if (status && status !== 'success' && status !== 'paid') return false;
        seen.add(reference);
        return true;
    });

    const imported = [];
    for (const tx of successes) {
        const payment = await upsertSuccessPaymentFromTransaction(userId, tx, {
            subscriptionCode: subCode,
            billingInterval: interval,
        });
        if (payment) imported.push(payment);
    }

    return imported;
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

export function successTransactionsFromSubscription(subscription) {
    const invoices = [
        ...(Array.isArray(subscription?.invoices) ? subscription.invoices : []),
        ...(subscription?.mostRecentInvoice ? [subscription.mostRecentInvoice] : []),
    ];
    const rows = [];
    for (const inv of invoices) {
        const tx = inv?.transaction && typeof inv.transaction === 'object' ? inv.transaction : {};
        const reference = typeof tx.reference === 'string'
            ? tx.reference
            : (typeof inv?.reference === 'string' ? inv.reference : '');
        if (!reference) continue;
        const status = String(tx.status || inv?.status || '').toLowerCase();
        if (status && status !== 'success' && status !== 'paid') continue;
        rows.push({
            reference,
            amount: tx.amount || inv?.amount,
            status: 'success',
            paid_at: tx.paid_at || inv?.paid_at || inv?.paidAt,
            channel: tx.channel || '',
            currency: tx.currency || 'NGN',
        });
    }
    return rows;
}

async function buildSubscriptionPayload(subscriptionCode, partialMeta = {}) {
    let customerCode = partialMeta.customerCode || '';
    let customerId = partialMeta.customerId || '';
    let emailToken = partialMeta.emailToken || '';
    let nextPaymentDate = partialMeta.nextPaymentDate || null;
    let invoices = [];
    let mostRecentInvoice = null;

    try {
        const sub = await fetchSubscription(subscriptionCode);
        customerCode = sub?.customer?.customer_code || customerCode;
        customerId = sub?.customer?.id || customerId;
        emailToken = sub?.email_token || emailToken;
        nextPaymentDate = nextPaymentDateFromSubscription(sub) || nextPaymentDate;
        invoices = Array.isArray(sub?.invoices) ? sub.invoices : [];
        mostRecentInvoice = sub?.most_recent_invoice || null;
    } catch (err) {
        console.error('[Paystack] fetchSubscription failed:', err.message);
    }

    return {
        subscriptionCode,
        customerCode,
        customerId,
        emailToken,
        nextPaymentDate,
        invoices,
        mostRecentInvoice,
    };
}

/**
 * Ensure a successful Paystack checkout is linked to BusinessInfo subscription fields.
 * Safe to call multiple times (verify retries, webhooks, repair).
 */
export async function ensurePaystackSubscriptionLinked({ userId, payment = null, paystackData = null }) {
    await expireAbandonedCheckouts(userId);

    let info = await reconcilePremiumUntilForUser(userId);
    if (!info) {
        info = await BusinessInfo.findOne({ userId });
    }
    if (!needsSubscriptionLink(info)) {
        const subscription = await buildSubscriptionPayload(info.paystackSubscriptionCode, {
            customerCode: info.paystackCustomerCode,
        });
        await backfillPaymentsFromSubscription(
            userId,
            subscription,
            info.billingInterval || 'monthly',
        );
        return applyPaystackNextPaymentDate(info);
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
    await backfillPaymentsFromSubscription(userId, subscription, billingInterval);

    const linked = isPremiumActive(info)
        ? await linkPaystackSubscription(userId, { subscription, billingInterval })
        : await activatePremiumForUser(userId, {
            months,
            billingInterval,
            subscription,
            premiumUntil: subscription.nextPaymentDate,
        });

    return applyPaystackNextPaymentDate(linked);
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
