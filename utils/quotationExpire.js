import Quotation from '../models/Quotation.js';

/** Local calendar date as YYYY-MM-DD (matches frontend comparisons). */
export function todayDateString(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Mark sent/accepted quotations past validUntil as expired — per user. */
export async function syncExpiredQuotationsForUser(userId) {
    const today = todayDateString();
    await Quotation.updateMany(
        {
            userId,
            status: { $in: ['sent', 'accepted'] },
            validUntil: { $exists: true, $nin: [null, ''], $lt: today },
        },
        { $set: { status: 'expired' } }
    );
}

/** Global expiry sync for scheduled jobs (all users). */
export async function syncAllExpiredQuotations() {
    const today = todayDateString();
    const result = await Quotation.updateMany(
        {
            status: { $in: ['sent', 'accepted'] },
            validUntil: { $exists: true, $nin: [null, ''], $lt: today },
        },
        { $set: { status: 'expired' } }
    );
    return {
        modifiedCount: result.modifiedCount ?? result.nModified ?? 0,
    };
}
