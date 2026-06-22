import Invoice from '../models/Invoice.js';
import BusinessInfo from '../models/CompanyInfo.js';
import MonthlyInvoiceUsage from '../models/MonthlyInvoiceUsage.js';
import { isPremiumActive } from './businessInfoHelpers.js';

export const FREE_MONTHLY_INVOICE_LIMIT = 5;

export function getCurrentMonthRange() {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return { start, end, periodKey };
}

export async function countInvoicesInCurrentMonth(userId, resetAfter = null) {
    const { start, end } = getCurrentMonthRange();
    const countStart =
        resetAfter instanceof Date && resetAfter > start ? resetAfter : start;
    return Invoice.countDocuments({
        userId,
        createdAt: { $gte: countStart, $lt: end },
        status: { $ne: 'draft' },
    });
}

export async function getInvoiceUsageForUser(userId) {
    const { start, end, periodKey } = getCurrentMonthRange();
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

    const usageDoc = await MonthlyInvoiceUsage.findOne({ userId, periodKey });
    const currentInvoiceCount = await countInvoicesInCurrentMonth(
        userId,
        usageDoc?.adminResetAt || null
    );
    // Seed from current invoices so users do not get extra slots after deployment.
    // Once the ledger is ahead, deleted invoices still count for the month.
    const used = Math.max(usageDoc?.count || 0, currentInvoiceCount);
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

export async function reserveInvoiceCreation(userId) {
    const usage = await getInvoiceUsageForUser(userId);
    if (usage.unlimited) return usage;

    if (!usage.canCreate) {
        const err = new Error(
            `Free plan limit reached: ${usage.limit} invoices per month. Upgrade to Premium for unlimited invoices.`
        );
        err.code = 'INVOICE_LIMIT_REACHED';
        err.status = 403;
        err.usage = usage;
        throw err;
    }

    const { periodKey } = getCurrentMonthRange();
    await MonthlyInvoiceUsage.updateOne(
        { userId, periodKey },
        { $setOnInsert: { userId, periodKey, count: 0 } },
        { upsert: true, setDefaultsOnInsert: true }
    );
    await MonthlyInvoiceUsage.updateOne(
        { userId, periodKey },
        { $max: { count: usage.used } }
    );
    await MonthlyInvoiceUsage.updateOne(
        { userId, periodKey },
        { $inc: { count: 1 } }
    );

    return getInvoiceUsageForUser(userId);
}

export async function releaseInvoiceCreation(userId) {
    const { periodKey } = getCurrentMonthRange();
    await MonthlyInvoiceUsage.updateOne(
        { userId, periodKey, count: { $gt: 0 } },
        { $inc: { count: -1 } }
    );
}

/** Admin: restore full free monthly quota (5 new invoices) for a free-plan user. */
export async function resetFreeInvoiceUsageForUser(userId) {
    const info = await BusinessInfo.findOne({ userId });
    if (isPremiumActive(info)) {
        const err = new Error('Premium users have unlimited invoices.');
        err.status = 400;
        throw err;
    }

    const { periodKey } = getCurrentMonthRange();
    const now = new Date();
    await MonthlyInvoiceUsage.updateOne(
        { userId, periodKey },
        { $set: { count: 0, adminResetAt: now } },
        { upsert: true }
    );

    return getInvoiceUsageForUser(userId);
}
