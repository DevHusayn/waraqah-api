import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import Quotation from '../models/Quotation.js';
import Client from '../models/Client.js';
import BusinessInfo from '../models/CompanyInfo.js';
import { getDraftCountForUser } from './documentDrafts.js';
import { getInvoiceUsageForUser } from './invoiceLimits.js';
import { toBusinessInfoResponse } from './businessInfoHelpers.js';
import { getCache, setCache, invalidateCachePrefix } from './cache.js';
import { INVOICE_ONLY_FILTER, RECEIPT_ONLY_FILTER } from './invoiceDocumentFilter.js';
import { MONEY_EPS } from './invoicePayments.js';
import { amountPaidOf } from './realizedSales.js';
import {
    buildDashboardAnalyticsFromDocs,
    buildPeriodSummaryFromDocs,
    computeMoneyPercentChange,
    computeRevenueStatsFromDocs,
} from './dashboardAnalytics.js';
import { syncOverdueInvoicesForUser } from './invoiceOverdue.js';
import { computePeriodProfitFromDocs } from './profitAnalytics.js';
import { getExpenseRecordsForUser, computePeriodExpensesFromRecords } from './expenseAnalytics.js';
import { loadProductCostMap } from './productCostResolver.js';
import {
    getBusinessTimezone,
    periodCacheKey,
    previousAnalyticsPeriod,
    resolveAnalyticsPeriod,
} from './timezone.js';
import {
    DOCUMENT_BOOKS_FIELDS,
    getBusinessCurrencyForUser,
    projectDocsIntoBooks,
} from './documentCurrency.js';

const DASHBOARD_CACHE_TTL_MS = 30_000;
const OVERDUE_LIMIT = 20;

const INVOICE_SUMMARY_FIELDS =
    'invoiceNumber receiptNumber clientId date dueDate status total amountPaid currency createdAt updatedAt';
const QUOTATION_SUMMARY_FIELDS =
    'quotationNumber clientId date validUntil status total currency createdAt updatedAt convertedInvoiceId';

function toUserObjectId(userId) {
    if (userId instanceof mongoose.Types.ObjectId) return userId;
    return new mongoose.Types.ObjectId(String(userId));
}

function mapSummary(doc) {
    return {
        ...doc,
        id: doc._id?.toString?.() || doc._id || doc.id,
    };
}

function roundMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
}

function balanceDueOf(inv) {
    return Math.max(0, roundMoney(inv.total) - amountPaidOf(inv));
}

/** Pending balance for one non-draft document (mirrors aggregation rules). */
export function computePendingBalance(doc) {
    if (!doc || doc.status === 'draft' || doc.status === 'cancelled') return 0;

    const balance = balanceDueOf(doc);

    if (['pending', 'partial', 'overdue'].includes(doc.status)) {
        return balance;
    }

    if (
        doc.documentType === 'receipt' &&
        doc.status === 'paid' &&
        roundMoney(doc.amountPaid) > MONEY_EPS &&
        balance > MONEY_EPS
    ) {
        return balance;
    }

    return 0;
}

/** Paid amount counted toward revenue (mirrors aggregation rules). */
export function computePaidRevenue(doc) {
    if (!doc || doc.status === 'cancelled' || doc.status === 'draft') return 0;
    return amountPaidOf(doc);
}

/** Revenue totals — computed in JS for clarity and to avoid aggregation $let scoping issues. */
async function getInvoiceRevenueStats(userId) {
    const uid = toUserObjectId(userId);
    const docs = await Invoice.find({ userId: uid, status: { $ne: 'draft' } })
        .select(`documentType status total amountPaid ${DOCUMENT_BOOKS_FIELDS}`)
        .lean();
    const businessCurrency = await getBusinessCurrencyForUser(userId);

    return computeRevenueStatsFromDocs(projectDocsIntoBooks(docs, businessCurrency));
}

async function attachClientNames(docs) {
    if (!docs.length) return [];

    const clientIds = [
        ...new Set(docs.map((d) => d.clientId?.toString?.() || d.clientId).filter(Boolean)),
    ];
    const clients = clientIds.length
        ? await Client.find({ _id: { $in: clientIds } }).select('name').lean()
        : [];
    const nameById = Object.fromEntries(
        clients.map((client) => [client._id.toString(), client.name || ''])
    );

    return docs.map((doc) => {
        const mapped = mapSummary(doc);
        const clientId = doc.clientId?.toString?.() || doc.clientId || null;
        return {
            ...mapped,
            clientName: nameById[clientId] || doc.clientName || 'Unknown Client',
        };
    });
}

/** Core dashboard payload — stats, recent documents, overdue alerts. */
export async function getDashboardForUser(userId, { summaryYear, summaryMonth, period } = {}) {
    const uid = toUserObjectId(userId);
    await syncOverdueInvoicesForUser(uid);
    const nonDraftFilter = { userId: uid, status: { $ne: 'draft' } };

    const [
        analyticsDocs,
        timeZone,
        recentInvoicesRaw,
        recentReceiptsRaw,
        recentQuotationsRaw,
        overdueRaw,
        draftCount,
        totalClients,
        totalQuotations,
        totalReceipts,
    ] = await Promise.all([
        Invoice.find(nonDraftFilter)
            .select(`date dueDate status total amountPaid documentType items discount discountType discountValue ${DOCUMENT_BOOKS_FIELDS}`)
            .lean(),
        getBusinessTimezone(userId),
        Invoice.find({ ...nonDraftFilter, ...INVOICE_ONLY_FILTER })
            .select(INVOICE_SUMMARY_FIELDS)
            .sort({ createdAt: -1 })
            .limit(5)
            .lean(),
        Invoice.find({ ...nonDraftFilter, ...RECEIPT_ONLY_FILTER })
            .select(INVOICE_SUMMARY_FIELDS)
            .sort({ createdAt: -1 })
            .limit(5)
            .lean(),
        Quotation.find(nonDraftFilter)
            .select(QUOTATION_SUMMARY_FIELDS)
            .sort({ createdAt: -1 })
            .limit(5)
            .lean(),
        Invoice.find({ userId: uid, status: 'overdue', ...INVOICE_ONLY_FILTER })
            .select(INVOICE_SUMMARY_FIELDS)
            .sort({ dueDate: 1 })
            .limit(OVERDUE_LIMIT)
            .lean(),
        getDraftCountForUser(userId),
        Client.countDocuments({ userId: uid }),
        Quotation.countDocuments(nonDraftFilter),
        Invoice.countDocuments({ userId: uid, status: 'paid', ...RECEIPT_ONLY_FILTER }),
    ]);

    const invoiceDocs = recentInvoicesRaw.map((inv) => ({
        ...inv,
        documentType: 'invoice',
        displayNumber: inv.invoiceNumber || '',
    }));
    const receiptDocs = recentReceiptsRaw.map((rec) => ({
        ...rec,
        documentType: 'receipt',
        displayNumber: rec.receiptNumber || '',
    }));
    const quotationDocs = recentQuotationsRaw.map((q) => ({
        ...q,
        documentType: 'quotation',
        displayNumber: q.quotationNumber || '',
    }));

    const mergedRecent = [...invoiceDocs, ...receiptDocs, ...quotationDocs]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5);

    const productCostById = await loadProductCostMap(userId, analyticsDocs);
    const businessCurrency = await getBusinessCurrencyForUser(userId);
    const booksDocs = projectDocsIntoBooks(analyticsDocs, businessCurrency);

    const revenueStats = computeRevenueStatsFromDocs(booksDocs);
    const analytics = buildDashboardAnalyticsFromDocs(booksDocs, { timeZone });
    const resolvedPeriod =
        period ||
        resolveAnalyticsPeriod({ summaryYear, summaryMonth }, timeZone);
    const periodSummary = buildPeriodSummaryFromDocs(booksDocs, {
        period: resolvedPeriod,
        timeZone,
    });

    const currentProfit = computePeriodProfitFromDocs(
        booksDocs,
        resolvedPeriod,
        null,
        timeZone,
        productCostById
    );
    const previousPeriod = previousAnalyticsPeriod(resolvedPeriod);
    const previousProfit = previousPeriod
        ? computePeriodProfitFromDocs(
              booksDocs,
              previousPeriod,
              null,
              timeZone,
              productCostById
          )
        : { totals: { grossProfit: 0 } };

    const expenses = await getExpenseRecordsForUser(userId);
    const currentExpenseTotals = computePeriodExpensesFromRecords(
        expenses,
        resolvedPeriod,
        null,
        timeZone
    );
    const previousExpenseTotals = previousPeriod
        ? computePeriodExpensesFromRecords(expenses, previousPeriod, null, timeZone)
        : { totalExpenses: 0 };
    const netProfit = roundMoney(
        currentProfit.totals.grossProfit - currentExpenseTotals.totalExpenses
    );
    const previousNetProfit = roundMoney(
        previousProfit.totals.grossProfit - previousExpenseTotals.totalExpenses
    );

    const periodSummaryWithProfit = {
        ...periodSummary,
        current: {
            ...periodSummary.current,
            grossProfit: currentProfit.totals.grossProfit,
            grossMarginPercent: currentProfit.totals.marginPercent,
            totalExpenses: currentExpenseTotals.totalExpenses,
            netProfit,
        },
        comparison:
            resolvedPeriod.kind === 'all'
                ? null
                : {
                      ...periodSummary.comparison,
                      grossProfit: computeMoneyPercentChange(
                          currentProfit.totals.grossProfit,
                          previousProfit.totals.grossProfit
                      ),
                      totalExpenses: computeMoneyPercentChange(
                          currentExpenseTotals.totalExpenses,
                          previousExpenseTotals.totalExpenses
                      ),
                      netProfit: computeMoneyPercentChange(netProfit, previousNetProfit),
                  },
    };

    const [recentDocuments, overdueInvoices] = await Promise.all([
        attachClientNames(mergedRecent),
        attachClientNames(overdueRaw),
    ]);

    const recentInvoices = recentDocuments.filter((d) => d.documentType === 'invoice');

    return {
        analytics,
        periodSummary: periodSummaryWithProfit,
        stats: {
            totalInvoices: revenueStats.totalInvoices,
            totalQuotations,
            totalReceipts,
            totalClients,
            paidRevenue: revenueStats.paidRevenue,
            pendingRevenue: revenueStats.pendingRevenue,
            draftCount,
        },
        recentDocuments,
        recentInvoices,
        overdueInvoices,
    };
}

/** Full aggregated dashboard with subscription and business info. */
export async function getFullDashboardForUser(userId, query = {}) {
    const timeZone = await getBusinessTimezone(userId);
    const resolvedPeriod = resolveAnalyticsPeriod(query, timeZone);
    const cacheKey = `${userId}:${periodCacheKey(resolvedPeriod)}`;
    const cached = getCache('dashboard', cacheKey);
    if (cached) return cached;

    const uid = toUserObjectId(userId);

    const [dashboard, invoiceUsage, businessDoc] = await Promise.all([
        getDashboardForUser(userId, { period: resolvedPeriod }),
        getInvoiceUsageForUser(userId),
        BusinessInfo.findOne({ userId: uid }).lean(),
    ]);

    const businessInfo = toBusinessInfoResponse(businessDoc, { includeAssets: false });

    const result = {
        ...dashboard,
        invoiceUsage,
        businessInfo,
        subscription: {
            plan: businessInfo?.plan || 'free',
            premiumUntil: businessInfo?.premiumUntil || null,
            subscriptionStatus: businessInfo?.subscriptionStatus || null,
            subscriptionRenews: businessInfo?.subscriptionRenews || null,
        },
    };

    setCache('dashboard', cacheKey, result, DASHBOARD_CACHE_TTL_MS);
    return result;
}

export function invalidateDashboardCache(userId) {
    invalidateCachePrefix('dashboard', String(userId));
}

/** Lightweight counts for app shell (sidebar draft badge). */
export async function getInvoiceMetaForUser(userId) {
    const draftCount = await getDraftCountForUser(userId);
    return { draftCount };
}
