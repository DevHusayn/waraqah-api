import Payment from '../models/Payment.js';

/** Abandoned checkout (user opened Paystack and went Back) stays pending this long. */
export const ABANDONED_CHECKOUT_MS = 60 * 60 * 1000;

/** Billing history is real charges only — not in-progress or abandoned checkouts. */
export function billingHistoryQuery(userId) {
    return { userId, status: 'success' };
}

export function isAbandonedPending(payment, now = new Date()) {
    if (!payment || payment.status !== 'pending') return false;
    const created = payment.createdAt ? new Date(payment.createdAt) : null;
    if (!created || Number.isNaN(created.getTime())) return false;
    return now.getTime() - created.getTime() >= ABANDONED_CHECKOUT_MS;
}

export async function expireAbandonedCheckouts(userId, now = new Date()) {
    const cutoff = new Date(now.getTime() - ABANDONED_CHECKOUT_MS);
    const filter = { status: 'pending', createdAt: { $lt: cutoff } };
    if (userId) filter.userId = userId;
    const result = await Payment.updateMany(filter, { $set: { status: 'failed' } });
    return result.modifiedCount ?? result.nModified ?? 0;
}
