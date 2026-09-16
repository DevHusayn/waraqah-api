import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import Product from '../models/Product.js';
import {
    buildRevenueTrendBuckets,
    computeMoneyPercentChange,
} from './dashboardAnalytics.js';
import {
    dateMatchesPeriod,
    formatAnalyticsPeriodLabel,
    getYearMonthInTimezone,
    normalizeTimezone,
    previousAnalyticsPeriod,
} from './timezone.js';
import {
    loadProductCostMap,
    resolveLineUnitCost,
    lineHasCostData,
    lineIsZeroCostService,
} from './productCostResolver.js';
import {
    computeDocumentDiscountRatio,
    computeLineSubtotal,
    computeMarginPercent,
    roundMoney,
} from './documentLineMath.js';
import {
    computePaidRatio,
    docCountsAsRealizedSale,
} from './realizedSales.js';
import {
    getExpenseRecordsForUser,
    buildExpenseSummaryFromRecords,
    computePeriodExpensesFromRecords,
    mergeExpensesIntoProfitSummary,
} from './expenseAnalytics.js';
import {
    DOCUMENT_BOOKS_FIELDS,
    getBusinessCurrencyForUser,
    projectDocsIntoBooks,
} from './documentCurrency.js';

export { loadProductCostMap };

const DEFAULT_TREND_MONTHS = 12;

function toUserObjectId(userId) {
    if (userId instanceof mongoose.Types.ObjectId) return userId;
    return new mongoose.Types.ObjectId(String(userId));
}

function bucketKey(year, month) {
    return `${year}-${month}`;
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

/**
 * Compute gross profit metrics for one document, scaled by paid ratio for partial payments.
 */
export function computeDocumentProfit(doc, productCostById = null) {
    if (!doc || doc.status === 'draft' || doc.status === 'cancelled') {
        return {
            revenue: 0,
            cogs: 0,
            grossProfit: 0,
            linesWithCost: 0,
            linesMissingCost: 0,
        };
    }

    if (!docCountsAsRealizedSale(doc)) {
        return {
            revenue: 0,
            cogs: 0,
            grossProfit: 0,
            linesWithCost: 0,
            linesMissingCost: 0,
        };
    }

    const paidRatio = computePaidRatio(doc);
    if (paidRatio <= 0) {
        return {
            revenue: 0,
            cogs: 0,
            grossProfit: 0,
            linesWithCost: 0,
            linesMissingCost: 0,
        };
    }

    const items = Array.isArray(doc.items) ? doc.items : [];
    const discountRatio = computeDocumentDiscountRatio(doc, items);

    let revenue = 0;
    let costedRevenue = 0;
    let cogs = 0;
    let linesWithCost = 0;
    let linesMissingCost = 0;

    for (const item of items) {
        const qty = Number(item.quantity) || 0;
        const rate = Number(item.rate) || 0;
        const lineRevenue = qty * rate;
        const adjustedRevenue = lineRevenue * (1 - discountRatio);
        const unitCost = resolveLineUnitCost(item, productCostById);
        const hasCost = lineHasCostData(item, productCostById);
        const isZeroCostService = lineIsZeroCostService(item, productCostById);

        revenue += adjustedRevenue;
        if (hasCost) {
            costedRevenue += adjustedRevenue;
            cogs += qty * unitCost;
            linesWithCost += 1;
        } else if (isZeroCostService) {
            costedRevenue += adjustedRevenue;
        } else if (item.productId) {
            linesMissingCost += 1;
        }
    }

    revenue = roundMoney(revenue * paidRatio);
    costedRevenue = roundMoney(costedRevenue * paidRatio);
    cogs = roundMoney(cogs * paidRatio);
    const grossProfit = roundMoney(costedRevenue - cogs);

    return {
        revenue,
        cogs,
        grossProfit,
        linesWithCost,
        linesMissingCost,
    };
}

function emptyTotals() {
    return {
        revenue: 0,
        cogs: 0,
        grossProfit: 0,
        marginPercent: 0,
        linesWithCost: 0,
        linesMissingCost: 0,
    };
}

/** Aggregate profit for docs issued in a calendar month. */
export function computePeriodProfitFromDocs(docs, year, month, timeZone, productCostById = null) {
    const tz = normalizeTimezone(timeZone);
    const totals = emptyTotals();
    const byProduct = new Map();

    for (const doc of docs) {
        if (!docIsInPeriod(doc, year, month, tz)) continue;

        if (!docCountsAsRealizedSale(doc)) continue;

        const docProfit = computeDocumentProfit(doc, productCostById);
        totals.revenue += docProfit.revenue;
        totals.cogs += docProfit.cogs;
        totals.grossProfit += docProfit.grossProfit;
        totals.linesWithCost += docProfit.linesWithCost;
        totals.linesMissingCost += docProfit.linesMissingCost;

        if (!Array.isArray(doc.items)) continue;

        const paidRatio = computePaidRatio(doc);
        if (paidRatio <= 0) continue;

        const lineSubtotal = computeLineSubtotal(doc.items);
        const discountRatio = computeDocumentDiscountRatio(doc, doc.items);

        for (const item of doc.items) {
            if (!item?.productId) continue;

            const productId = String(item.productId);
            const qty = Number(item.quantity) || 0;
            const rate = Number(item.rate) || 0;
            const unitCost = resolveLineUnitCost(item, productCostById);
            const hasCost = lineHasCostData(item, productCostById);
            const isZeroCostService = lineIsZeroCostService(item, productCostById);
            const lineRevenue = roundMoney(qty * rate * (1 - discountRatio) * paidRatio);
            const lineCogs = hasCost ? roundMoney(qty * unitCost * paidRatio) : 0;
            const lineProfit =
                hasCost || isZeroCostService ? roundMoney(lineRevenue - lineCogs) : 0;

            const existing = byProduct.get(productId) || {
                productId,
                name: item.description || 'Product',
                revenue: 0,
                cogs: 0,
                grossProfit: 0,
                qtySold: 0,
            };

            existing.revenue += lineRevenue;
            existing.cogs += lineCogs;
            existing.grossProfit += lineProfit;
            existing.qtySold += qty * paidRatio;
            if (item.description) existing.name = item.description;

            byProduct.set(productId, existing);
        }
    }

    totals.revenue = roundMoney(totals.revenue);
    totals.cogs = roundMoney(totals.cogs);
    totals.grossProfit = roundMoney(totals.grossProfit);
    totals.marginPercent = computeMarginPercent(totals.cogs + totals.grossProfit, totals.grossProfit);

    const byProductRows = [...byProduct.values()]
        .map((row) => ({
            ...row,
            revenue: roundMoney(row.revenue),
            cogs: roundMoney(row.cogs),
            grossProfit: roundMoney(row.grossProfit),
            qtySold: roundMoney(row.qtySold),
            marginPercent: computeMarginPercent(row.cogs + row.grossProfit, row.grossProfit),
        }))
        .sort((a, b) => b.grossProfit - a.grossProfit);

    return { totals, byProduct: byProductRows };
}

export function buildProfitTrendFromDocs(
    docs,
    { months = DEFAULT_TREND_MONTHS, timeZone, now = new Date(), productCostById = null } = {}
) {
    const tz = normalizeTimezone(timeZone);
    const buckets = buildRevenueTrendBuckets({ months, timeZone: tz, now });
    const bucketMap = new Map(buckets.map((bucket) => [bucketKey(bucket.year, bucket.month), bucket]));

    for (const doc of docs) {
        if (!doc?.date || doc.status === 'draft' || doc.status === 'cancelled') continue;
        if (!docCountsAsRealizedSale(doc)) continue;

        const issueDate = new Date(doc.date);
        if (Number.isNaN(issueDate.getTime())) continue;

        const { year, month } = getYearMonthInTimezone(tz, issueDate);
        const bucket = bucketMap.get(bucketKey(year, month));
        if (!bucket) continue;

        const docProfit = computeDocumentProfit(doc, productCostById);
        bucket.grossProfit = (bucket.grossProfit || 0) + docProfit.grossProfit;
        bucket.revenue = (bucket.revenue || 0) + docProfit.revenue;
        bucket.cogs = (bucket.cogs || 0) + docProfit.cogs;
    }

    return buckets.map((bucket) => {
        const grossProfit = roundMoney(bucket.grossProfit || 0);
        const revenue = roundMoney(bucket.revenue || 0);
        const cogs = roundMoney(bucket.cogs || 0);
        return {
            year: bucket.year,
            month: bucket.month,
            label: bucket.label,
            grossProfit,
            revenue,
            marginPercent: computeMarginPercent(cogs + grossProfit, grossProfit),
        };
    });
}

export function buildProfitComparison(currentTotals, previousTotals) {
    return {
        grossProfit: computeMoneyPercentChange(
            currentTotals.grossProfit,
            previousTotals.grossProfit
        ),
        marginPercent: computeMoneyPercentChange(
            currentTotals.marginPercent,
            previousTotals.marginPercent
        ),
        revenue: computeMoneyPercentChange(currentTotals.revenue, previousTotals.revenue),
    };
}

export function buildProfitSummaryFromDocs(
    docs,
    { year, month, timeZone, months = DEFAULT_TREND_MONTHS, now = new Date(), productCostById = null, period } = {}
) {
    const tz = normalizeTimezone(timeZone);
    const resolvedPeriod =
        period ||
        (Number.isFinite(year) && Number.isFinite(month)
            ? { kind: 'month', year, month }
            : { kind: 'month', ...getYearMonthInTimezone(tz, now) });

    const current = computePeriodProfitFromDocs(docs, resolvedPeriod, null, tz, productCostById);
    const trend = buildProfitTrendFromDocs(docs, { months, timeZone: tz, now, productCostById });

    if (resolvedPeriod.kind === 'all') {
        return {
            period: {
                kind: 'all',
                label: formatAnalyticsPeriodLabel(resolvedPeriod, 'en-US', tz),
                timezone: tz,
            },
            totals: current.totals,
            byProduct: current.byProduct,
            trend,
            comparison: null,
        };
    }

    const previousPeriod = previousAnalyticsPeriod(resolvedPeriod);
    const previous = computePeriodProfitFromDocs(docs, previousPeriod, null, tz, productCostById);

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
        totals: current.totals,
        byProduct: current.byProduct,
        trend,
        comparison: buildProfitComparison(current.totals, previous.totals),
    };
}

export async function getProfitSummaryForUser(
    userId,
    { year, month, timeZone, months = DEFAULT_TREND_MONTHS, period } = {}
) {
    const uid = toUserObjectId(userId);
    const docs = await Invoice.find({ userId: uid, status: { $ne: 'draft' } })
        .select(`date status total amountPaid documentType items discount discountType discountValue ${DOCUMENT_BOOKS_FIELDS}`)
        .lean();
    const businessCurrency = await getBusinessCurrencyForUser(userId);
    const booksDocs = projectDocsIntoBooks(docs, businessCurrency);

    const [productCostById, products] = await Promise.all([
        loadProductCostMap(userId, docs),
        (async () => {
            const productIds = new Set();
            for (const doc of docs) {
                for (const item of doc.items || []) {
                    if (item?.productId) productIds.add(String(item.productId));
                }
            }
            if (!productIds.size) return [];
            return Product.find({
                userId: uid,
                _id: { $in: [...productIds].map((id) => new mongoose.Types.ObjectId(id)) },
            })
                .select('name')
                .lean();
        })(),
    ]);

    const nameById = new Map(products.map((product) => [String(product._id), product.name || 'Product']));

    const summary = buildProfitSummaryFromDocs(booksDocs, {
        year,
        month,
        timeZone,
        months,
        productCostById,
        period,
    });
    summary.byProduct = summary.byProduct.map((row) => ({
        ...row,
        name: nameById.get(row.productId) || row.name,
    }));

    const expenses = await getExpenseRecordsForUser(userId);
    const tz = normalizeTimezone(timeZone);
    const resolvedPeriod =
        period ||
        (Number.isFinite(year) && Number.isFinite(month)
            ? { kind: 'month', year, month }
            : { kind: 'month', ...getYearMonthInTimezone(tz) });

    const currentExpenseTotals = computePeriodExpensesFromRecords(
        expenses,
        resolvedPeriod,
        null,
        tz
    );

    const previousPeriod = previousAnalyticsPeriod(resolvedPeriod);
    const previousPeriodProfit = previousPeriod
        ? computePeriodProfitFromDocs(booksDocs, previousPeriod, null, tz, productCostById)
        : { totals: { grossProfit: 0, revenue: 0 } };
    const previousExpenseTotals = {
        ...(previousPeriod
            ? computePeriodExpensesFromRecords(expenses, previousPeriod, null, tz)
            : { totalExpenses: 0 }),
        grossProfit: previousPeriodProfit.totals.grossProfit,
        revenue: previousPeriodProfit.totals.revenue,
    };

    const expenseSummary = buildExpenseSummaryFromRecords(expenses, {
        year,
        month,
        timeZone: tz,
        months,
        period: resolvedPeriod,
    });

    return mergeExpensesIntoProfitSummary(summary, {
        currentExpenseTotals,
        previousExpenseTotals,
        expenseTrend: expenseSummary.trend,
        byCategory: expenseSummary.byCategory,
    });
}

/** Lightweight period profit totals for dashboard stat cards. */
export function computePeriodGrossProfitFromDocs(docs, year, month, timeZone, productCostById = null) {
    return computePeriodProfitFromDocs(docs, year, month, timeZone, productCostById).totals;
}
