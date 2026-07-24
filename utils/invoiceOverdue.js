import Invoice from '../models/Invoice.js';

/** Local calendar date as YYYY-MM-DD (matches frontend due-date comparisons). */
export function todayDateString(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

const OVERDUE_ELIGIBLE = ['pending', 'partial'];

/** Mark pending/partial invoices past due as overdue — single bulk update per request. */
export async function syncOverdueInvoicesForUser(userId) {
    const today = todayDateString();
    await Invoice.updateMany(
        {
            userId,
            status: { $in: OVERDUE_ELIGIBLE },
            dueDate: { $exists: true, $nin: [null, ''], $lt: today },
        },
        { $set: { status: 'overdue' } }
    );
}

/** Global overdue sync for scheduled jobs (all users). */
export async function syncAllOverdueInvoices() {
    const today = todayDateString();
    const result = await Invoice.updateMany(
        {
            status: { $in: OVERDUE_ELIGIBLE },
            dueDate: { $exists: true, $nin: [null, ''], $lt: today },
        },
        { $set: { status: 'overdue' } }
    );
    return {
        modifiedCount: result.modifiedCount ?? result.nModified ?? 0,
    };
}
