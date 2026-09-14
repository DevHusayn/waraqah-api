import User from '../models/User.js';
import Payment from '../models/Payment.js';
import UserActivityLog from '../models/UserActivityLog.js';
import { buildPaginationMeta } from './pagination.js';

const LOG_CAP = 200;
const PAYMENT_CAP = 100;

const TYPE_LABELS = {
    account_created: 'Account created',
    login: 'Signed in',
    suspended: 'Account suspended',
    reactivated: 'Account reactivated',
    plan_upgraded: 'Upgraded to Premium',
    plan_downgraded: 'Downgraded to Free',
    subscription_cancelled: 'Subscription cancelled',
    subscription_payment_failed: 'Payment failed',
    payment_success: 'Payment successful',
    payment_failed: 'Payment failed',
    admin_email_sent: 'Email sent by admin',
};

function formatPaymentEvent(payment) {
    const success = payment.status === 'success';
    return {
        id: `payment-${payment._id}`,
        type: success ? 'payment_success' : payment.status === 'failed' ? 'payment_failed' : 'payment_success',
        at: payment.paidAt || payment.createdAt,
        title: success ? 'Premium payment received' : 'Premium payment failed',
        description: payment.reference
            ? `Paystack ref: ${payment.reference}`
            : 'Subscription payment',
        meta: {
            reference: payment.reference,
            amount: payment.amount / 100,
            currency: payment.currency || 'NGN',
            status: payment.status,
            billingInterval: payment.billingInterval,
        },
    };
}

function formatLogEvent(log) {
    return {
        id: `log-${log._id}`,
        type: log.type,
        at: log.createdAt,
        title: log.title || TYPE_LABELS[log.type] || log.type,
        description: log.description || '',
        meta: log.meta || null,
        actorId: log.actorId || null,
    };
}

export async function buildUserTimeline(userId, { page, limit, skip }) {
    const user = await User.findById(userId).select('createdAt email').lean();
    if (!user) return null;

    const [logs, payments] = await Promise.all([
        UserActivityLog.find({ userId }).sort({ createdAt: -1 }).limit(LOG_CAP).lean(),
        Payment.find({ userId }).sort({ createdAt: -1 }).limit(PAYMENT_CAP).lean(),
    ]);

    const events = [
        {
            id: `account-${userId}`,
            type: 'account_created',
            at: user.createdAt,
            title: TYPE_LABELS.account_created,
            description: user.email ? `${user.email} registered` : 'User registered',
            meta: null,
        },
        ...logs.map(formatLogEvent),
        ...payments
            .filter((p) => p.status === 'success' || p.status === 'failed')
            .map(formatPaymentEvent),
    ];

    events.sort((a, b) => new Date(b.at) - new Date(a.at));

    const total = events.length;
    const data = events.slice(skip, skip + limit);

    return {
        data,
        pagination: buildPaginationMeta(page, limit, total),
    };
}

export async function buildSubscriptionHistory(userId, { page, limit, skip }) {
    const [logs, payments] = await Promise.all([
        UserActivityLog.find({
            userId,
            type: {
                $in: [
                    'plan_upgraded',
                    'plan_downgraded',
                    'subscription_cancelled',
                    'subscription_payment_failed',
                    'payment_success',
                    'payment_failed',
                ],
            },
        })
            .sort({ createdAt: -1 })
            .limit(100)
            .lean(),
        Payment.find({ userId, type: 'subscription' })
            .sort({ createdAt: -1 })
            .limit(100)
            .lean(),
    ]);

    const events = [
        ...logs.map(formatLogEvent),
        ...payments.map((p) => ({
            ...formatPaymentEvent(p),
            title:
                p.status === 'success'
                    ? p.billingInterval === 'yearly'
                        ? 'Yearly subscription payment'
                        : 'Monthly subscription payment'
                    : 'Subscription payment failed',
        })),
    ];

    events.sort((a, b) => new Date(b.at) - new Date(a.at));

    const seen = new Set();
    const deduped = events.filter((e) => {
        const key = `${e.type}-${e.at}-${e.meta?.reference || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const total = deduped.length;
    const data = deduped.slice(skip, skip + limit);

    return {
        data,
        pagination: buildPaginationMeta(page, limit, total),
    };
}
