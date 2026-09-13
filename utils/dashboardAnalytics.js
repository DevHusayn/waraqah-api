import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import { INVOICE_ONLY_FILTER } from './invoiceDocumentFilter.js';
import { computePaidRevenue, computePendingBalance } from './dashboardStats.js';
import { getYearMonthInTimezone, normalizeTimezone, dateMatchesPeriod, previousAnalyticsPeriod, formatAnalyticsPeriodLabel, getDatePartsInTimezone, toDateInputValue } from './timezone.js';
import { isPartialReceiptDoc } from './receiptValidation.js';
import { getReceiptPaymentStatusCounts } from './receiptCounts.js';

const DEFAULT_TREND_MONTHS = 12;

function toUserObjectId(userId) {
    if (userId instanceof mongoose.Types.ObjectId) return userId;
    return new mongoose.Types.ObjectId(String(userId));
}

function roundMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
}

export function shiftSummaryPeriod(year, month, deltaMonths) {
    const index = year * 12 + (month - 1) + deltaMonths;
    return {
        year: Math.floor(index / 12),
        month: (index % 12) + 1,
    };
}

export function formatTrendMonthLabel(year, month, locale = 'en-US') {
    const date = new Date(Date.UTC(year, month - 1, 1));
    return new Intl.DateTimeFormat(locale, {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(date);
}

function bucketKey(year, month) {
    return `${year}-${month}`;
}

/** Build empty month buckets ending at the current month in the business timezone. */
export function buildRevenueTrendBuckets({ months = DEFAULT_TREND_MONTHS, timeZone, now = new Date() }) {
    const tz = normalizeTimezone(timeZone);
    const current = getYearMonthInTimezone(tz, now);
    const buckets = [];

    for (let offset = months - 1; offset >= 0; offset -= 1) {
        const { year, month } = shiftSummaryPeriod(current.year, current.month, -offset);
        buckets.push({
            year,
            month,
            label: formatTrendMonthLabel(year, month),
            paid: 0,
            outstanding: 0,
        });
    }

    return buckets;
}

/** Pure revenue trend builder — bucketed by invoice issue date in the business timezone. */
export function buildRevenueTrendFromDocs(docs, { months = DEFAULT_TREND_MONTHS, timeZone, now = new Date() }) {
    const tz = normalizeTimezone(timeZone);
    const buckets = buildRevenueTrendBuckets({ months, timeZone: tz, now });
    const bucketMap = new Map(buckets.map((bucket) => [bucketKey(bucket.year, bucket.month), bucket]));

    for (const doc of docs) {
        if (!doc?.date) continue;
        const issueDate = new Date(doc.date);
        if (Number.isNaN(issueDate.getTime())) continue;

        const { year, month } = getYearMonthInTimezone(tz, issueDate);
        const bucket = bucketMap.get(bucketKey(year, month));
        if (!bucket) continue;

        bucket.paid += computePaidRevenue(doc);
        bucket.outstanding += computePendingBalance(doc);
    }

    return buckets.map((bucket) => ({
        ...bucket,
        paid: roundMoney(bucket.paid),
        outstanding: roundMoney(bucket.outstanding),
    }));
}

export const MONEY_COMPARISON_MIN_BASELINE = 5000;
export const MAX_COMPARISON_PERCENT = 999;

/**
 * Month-over-month comparison with sane handling for near-zero baselines.
 * Returns kind: flat | new | unavailable | percent | capped
 */
export function computePercentChange(current, previous, { minBaseline = 0 } = {}) {
    const currentValue = Number(current) || 0;
    const previousValue = Number(previous) || 0;

    if (currentValue === 0 && previousValue === 0) {
        return { kind: 'flat', direction: 'flat' };
    }

    if (previousValue === 0) {
        return { kind: 'new', direction: currentValue > 0 ? 'up' : 'flat' };
    }

    if (minBaseline > 0 && previousValue < minBaseline) {
        return { kind: 'unavailable', direction: 'flat' };
    }

    const raw = ((currentValue - previousValue) / previousValue) * 100;
    const rounded = Math.round(raw);

    if (rounded === 0) {
        return { kind: 'flat', direction: 'flat' };
    }

    const direction = rounded > 0 ? 'up' : 'down';
    const absValue = Math.abs(rounded);

    if (absValue > MAX_COMPARISON_PERCENT) {
        return { kind: 'capped', value: MAX_COMPARISON_PERCENT, direction };
    }

    return {
        kind: 'percent',
        value: absValue,
        direction,
    };
}

export function computeMoneyPercentChange(current, previous) {
    return computePercentChange(current, previous, { minBaseline: MONEY_COMPARISON_MIN_BASELINE });
}

export function computeCountPercentChange(current, previous) {
    return computePercentChange(current, previous, { minBaseline: 0 });
}

function resolvePeriodArg(yearOrPeriod, month, timeZone) {
    if (yearOrPeriod && typeof yearOrPeriod === 'object') return yearOrPeriod;
    if (Number.isFinite(yearOrPeriod) && Number.isFinite(month)) {
        return { kind: 'month', year: yearOrPeriod, month };
    }
    return { kind: 'month', ...getYearMonthInTimezone(timeZone) };
}

function docIsInPeriod(doc, year, month, timeZone) {
    return dateMatchesPeriod(doc?.date, resolvePeriodArg(year, month, timeZone), timeZone);
}

function isInvoiceDoc(doc) {
    return doc.documentType === 'invoice' || doc.documentType == null;
}

function isReceiptDoc(doc) {
    return doc.documentType === 'receipt';
}

/** Period metrics bucketed by invoice issue date in the business timezone. */
export function computePeriodSummaryFromDocs(docs, year, month, timeZone) {
    const tz = normalizeTimezone(timeZone);
    let totalRevenue = 0;
    let outstanding = 0;
    let paidInvoices = 0;
    let receiptsIssued = 0;

    for (const doc of docs) {
        if (!docIsInPeriod(doc, year, month, tz)) continue;
        if (doc.status === 'draft' || doc.status === 'cancelled') continue;

        totalRevenue += computePaidRevenue(doc);
        outstanding += computePendingBalance(doc);

        if (isReceiptDoc(doc) && doc.status === 'paid' && !isPartialReceiptDoc(doc)) {
            receiptsIssued += 1;
        } else if (isInvoiceDoc(doc) && doc.status === 'paid') {
            paidInvoices += 1;
        }
    }

    return {
        totalRevenue: roundMoney(totalRevenue),
        outstanding: roundMoney(outstanding),
        paidInvoices,
        receiptsIssued,
        paymentsReceived: paidInvoices + receiptsIssued,
    };
}

function docDueDateIsInPeriod(doc, year, month, timeZone) {
    return dateMatchesPeriod(doc?.dueDate, resolvePeriodArg(year, month, timeZone), timeZone);
}

function todayDateStringInTimezone(timeZone, now = new Date()) {
    const parts = getDatePartsInTimezone(normalizeTimezone(timeZone), now);
    return toDateInputValue(parts.year, parts.month, parts.day);
}

/** Unpaid invoice past due, or explicitly marked overdue. */
export function isUnpaidOverdueInvoice(doc, todayStr) {
    if (!isInvoiceDoc(doc)) return false;
    if (doc.status === 'cancelled' || doc.status === 'draft' || doc.status === 'paid') return false;
    if (doc.status === 'overdue') return true;
    if (['pending', 'partial'].includes(doc.status) && doc.dueDate && doc.dueDate < todayStr) {
        return true;
    }
    return false;
}

/** Status counts for documents issued in period; overdue counts by due date in period. */
export function computePeriodPaymentBreakdownFromDocs(docs, year, month, timeZone, now = new Date()) {
    const tz = normalizeTimezone(timeZone);
    const todayStr = todayDateStringInTimezone(tz, now);
    let fullyPaidInvoices = 0;
    let fullyPaidReceipts = 0;
    let partialInvoices = 0;
    let partialReceipts = 0;
    let pending = 0;
    let overdue = 0;

    for (const doc of docs) {
        if (!docIsInPeriod(doc, year, month, tz)) continue;
        if (doc.status === 'draft' || doc.status === 'cancelled') continue;

        if (isReceiptDoc(doc)) {
            if (doc.status === 'paid') {
                if (isPartialReceiptDoc(doc)) partialReceipts += 1;
                else fullyPaidReceipts += 1;
            }
            continue;
        }

        if (!isInvoiceDoc(doc)) continue;

        if (doc.status === 'paid') {
            fullyPaidInvoices += 1;
        } else if (isUnpaidOverdueInvoice(doc, todayStr)) {
            continue;
        } else if (doc.status === 'partial') {
            partialInvoices += 1;
        } else if (doc.status === 'pending') {
            pending += 1;
        }
    }

    for (const doc of docs) {
        if (!isInvoiceDoc(doc)) continue;
        if (doc.status === 'draft' || doc.status === 'cancelled') continue;
        if (!isUnpaidOverdueInvoice(doc, todayStr)) continue;
        if (!docDueDateIsInPeriod(doc, year, month, tz)) continue;
        overdue += 1;
    }

    const issuedInPeriod =
        fullyPaidInvoices +
        fullyPaidReceipts +
        partialInvoices +
        partialReceipts +
        pending;

    const total = issuedInPeriod + overdue;

    return {
        fullyReceived: fullyPaidInvoices + fullyPaidReceipts,
        partiallyReceived: partialInvoices + partialReceipts,
        partialInvoices,
        partialReceipts,
        pending,
        overdue,
        fullyPaidInvoices,
        fullyPaidReceipts,
        issuedInPeriod,
        total,
    };
}

export function buildPeriodSummaryComparison(currentSummary, previousSummary) {
    return {
        totalRevenue: computeMoneyPercentChange(
            currentSummary.totalRevenue,
            previousSummary.totalRevenue
        ),
        outstanding: computeMoneyPercentChange(
            currentSummary.outstanding,
            previousSummary.outstanding
        ),
        paymentsReceived: computeCountPercentChange(
            currentSummary.paymentsReceived,
            previousSummary.paymentsReceived
        ),
    };
}

export function computeRevenueStatsFromDocs(docs) {
    let totalInvoices = 0;
    let paidRevenue = 0;
    let pendingRevenue = 0;

    for (const doc of docs) {
        const isInvoice = doc.documentType === 'invoice' || doc.documentType == null;
        if (isInvoice) totalInvoices += 1;

        paidRevenue += computePaidRevenue(doc);
        pendingRevenue += computePendingBalance(doc);
    }

    return {
        totalInvoices,
        paidRevenue: roundMoney(paidRevenue),
        pendingRevenue: roundMoney(pendingRevenue),
    };
}

export function buildDashboardAnalyticsFromDocs(docs, { timeZone, months = DEFAULT_TREND_MONTHS } = {}) {
    const tz = normalizeTimezone(timeZone);
    return {
        revenueTrend: buildRevenueTrendFromDocs(docs, { months, timeZone: tz }),
    };
}

export function buildPeriodSummaryFromDocs(docs, { year, month, timeZone, period } = {}) {
    const tz = normalizeTimezone(timeZone);
    const resolvedPeriod =
        period ||
        (Number.isFinite(year) && Number.isFinite(month)
            ? { kind: 'month', year, month }
            : { kind: 'month', ...getYearMonthInTimezone(tz) });

    const current = computePeriodSummaryFromDocs(docs, resolvedPeriod, null, tz);
    const paymentBreakdown = computePeriodPaymentBreakdownFromDocs(
        docs,
        resolvedPeriod,
        null,
        tz
    );

    if (resolvedPeriod.kind === 'all') {
        return {
            period: {
                kind: 'all',
                label: formatAnalyticsPeriodLabel(resolvedPeriod, 'en-US', tz),
                timezone: tz,
            },
            current,
            previous: null,
            paymentBreakdown,
            comparison: null,
        };
    }

    const previousPeriod = previousAnalyticsPeriod(resolvedPeriod);
    const previous = computePeriodSummaryFromDocs(docs, previousPeriod, null, tz);

    return {
        period: {
            kind: resolvedPeriod.kind,
            year: resolvedPeriod.year,
            month: resolvedPeriod.month,
            day: resolvedPeriod.day,
            startYear: resolvedPeriod.startYear,
            startMonth: resolvedPeriod.startMonth,
            startDay: resolvedPeriod.startDay,
            endYear: resolvedPeriod.endYear,
            endMonth: resolvedPeriod.endMonth,
            endDay: resolvedPeriod.endDay,
            label: formatAnalyticsPeriodLabel(resolvedPeriod, 'en-US', tz),
            timezone: tz,
        },
        current,
        previous,
        paymentBreakdown,
        comparison: buildPeriodSummaryComparison(current, previous),
    };
}

export async function getPeriodSummaryWithComparison(userId, { year, month, timeZone, period } = {}) {
    const uid = toUserObjectId(userId);
    const docs = await Invoice.find({ userId: uid, status: { $ne: 'draft' } })
        .select('date dueDate status total amountPaid documentType')
        .lean();

    return buildPeriodSummaryFromDocs(docs, { year, month, timeZone, period });
}

export async function getInvoiceStatusCounts(userId, extraMatch = {}) {
    const uid = toUserObjectId(userId);
    const rows = await Invoice.aggregate([
        { $match: { userId: uid, status: { $ne: 'draft' }, ...INVOICE_ONLY_FILTER, ...extraMatch } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const statusCounts = { all: 0, pending: 0, partial: 0, paid: 0, overdue: 0, cancelled: 0 };
    for (const row of rows) {
        const key = row._id;
        if (key && Object.prototype.hasOwnProperty.call(statusCounts, key)) {
            statusCounts[key] = row.count;
        }
        statusCounts.all += row.count;
    }
    return statusCounts;
}

/** Combined invoice + receipt counts for the dashboard payment breakdown. */
export function buildPaymentBreakdown(invoiceStatusCounts, receiptCounts = {}) {
    const paidInvoices = invoiceStatusCounts?.paid ?? 0;
    const receiptPartial = receiptCounts?.partial ?? 0;
    const partial = (invoiceStatusCounts?.partial ?? 0) + receiptPartial;
    const pending = invoiceStatusCounts?.pending ?? 0;
    const overdue = invoiceStatusCounts?.overdue ?? 0;
    const receipts = receiptCounts?.full ?? 0;
    const total = paidInvoices + receipts + partial + pending + overdue;

    return {
        paidInvoices,
        receiptsIssued: receipts,
        partial,
        pending,
        overdue,
        total,
    };
}

export async function getPaymentBreakdown(userId) {
    const [invoiceStatusCounts, receiptCounts] = await Promise.all([
        getInvoiceStatusCounts(userId),
        getReceiptPaymentStatusCounts(userId),
    ]);

    return buildPaymentBreakdown(invoiceStatusCounts, receiptCounts);
}

export async function getRevenueTrend(userId, { months = DEFAULT_TREND_MONTHS, timeZone } = {}) {
    const uid = toUserObjectId(userId);
    const tz = normalizeTimezone(timeZone);
    const docs = await Invoice.find({ userId: uid, status: { $ne: 'draft' } })
        .select('date dueDate status total amountPaid documentType')
        .lean();

    return buildRevenueTrendFromDocs(docs, { months, timeZone: tz });
}

export async function getDashboardAnalytics(userId, { timeZone, months = DEFAULT_TREND_MONTHS, docs } = {}) {
    if (docs) {
        return buildDashboardAnalyticsFromDocs(docs, { timeZone, months });
    }

    const uid = toUserObjectId(userId);
    const loadedDocs = await Invoice.find({ userId: uid, status: { $ne: 'draft' } })
        .select('date status total amountPaid documentType')
        .lean();

    return buildDashboardAnalyticsFromDocs(loadedDocs, { timeZone, months });
}
