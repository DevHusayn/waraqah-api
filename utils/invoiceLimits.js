import Invoice from '../models/Invoice.js';
import BusinessInfo from '../models/CompanyInfo.js';
import { isPremiumActive } from './businessInfoHelpers.js';

export const FREE_MONTHLY_INVOICE_LIMIT = 5;

export function getCurrentMonthRange() {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { start, end };
}

export async function countInvoicesInCurrentMonth(userId) {
    const { start, end } = getCurrentMonthRange();
    return Invoice.countDocuments({
        userId,
        createdAt: { $gte: start, $lt: end },
    });
}

export async function getInvoiceUsageForUser(userId) {
    const { start, end } = getCurrentMonthRange();
    const info = await BusinessInfo.findOne({ userId });

    if (isPremiumActive(info)) {
        return {
            unlimited: true,
            limit: null,
            used: 0,
            remaining: null,
            canCreate: true,
            periodStart: start.toISOString(),
            periodEnd: end.toISOString(),
        };
    }

    const used = await countInvoicesInCurrentMonth(userId);
    const limit = FREE_MONTHLY_INVOICE_LIMIT;
    const remaining = Math.max(0, limit - used);

    return {
        unlimited: false,
        limit,
        used,
        remaining,
        canCreate: used < limit,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
    };
}

export async function assertCanCreateInvoice(userId) {
    const usage = await getInvoiceUsageForUser(userId);
    if (!usage.canCreate) {
        const err = new Error(
            `Free plan limit reached: ${usage.limit} invoices per month. Upgrade to Premium for unlimited invoices.`
        );
        err.code = 'INVOICE_LIMIT_REACHED';
        err.status = 403;
        err.usage = usage;
        throw err;
    }
    return usage;
}
