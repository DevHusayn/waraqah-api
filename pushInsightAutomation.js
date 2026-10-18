import BusinessInfo from './models/CompanyInfo.js';
import Invoice from './models/Invoice.js';
import PushSubscription from './models/PushSubscription.js';
import User from './models/User.js';
import {
    buildPeriodSummaryFromDocs,
    isUnpaidOverdueInvoice,
} from './utils/dashboardAnalytics.js';
import { computePendingBalance } from './utils/dashboardStats.js';
import {
    DOCUMENT_BOOKS_FIELDS,
    getBusinessCurrencyForUser,
    projectDocsIntoBooks,
} from './utils/documentCurrency.js';
import { chooseInsight, DUE_SOON_DAYS, shouldSendInsight } from './utils/pushInsight.js';
import { findLowStockProductsForUser, findOutOfStockProductsForUser } from './utils/lowStockProducts.js';
import { isPushConfigured, sendPushToSubscriptions } from './utils/webPush.js';
import { getLocalClockInTimezone, shiftDateByDays, toDateInputValue } from './utils/timezone.js';

const BATCH_SIZE = 50;

function isInvoiceDoc(doc) {
    return doc.documentType === 'invoice' || doc.documentType == null;
}

function localDatePlusDays(localDate, days) {
    const [year, month, day] = localDate.split('-').map((part) => Number.parseInt(part, 10));
    const shifted = shiftDateByDays(year, month, day, days);
    return toDateInputValue(shifted.year, shifted.month, shifted.day);
}

function summarizeInvoices(docs, timeZone, localDate) {
    const invoices = docs.filter(isInvoiceDoc);
    const summary = buildPeriodSummaryFromDocs(invoices, { timeZone });
    const dueUntil = localDatePlusDays(localDate, DUE_SOON_DAYS);
    let overdueCount = 0;
    let overdueAmount = 0;
    let dueSoonCount = 0;

    for (const doc of invoices) {
        if (isUnpaidOverdueInvoice(doc, localDate)) {
            const balance = computePendingBalance(doc);
            if (balance > 0) {
                overdueCount += 1;
                overdueAmount += balance;
            }
            continue;
        }
        if (!['pending', 'partial'].includes(doc.status) || !doc.dueDate) continue;
        if (doc.dueDate >= localDate && doc.dueDate <= dueUntil) {
            dueSoonCount += 1;
        }
    }

    return {
        overdueCount,
        overdueAmount: Math.round(overdueAmount * 100) / 100,
        outstanding: summary.current.outstanding,
        collected: summary.current.totalRevenue,
        collectedComparison: summary.comparison?.totalRevenue || null,
        dueSoonCount,
    };
}

async function sendInsightForUser(userId, subscriptions, now) {
    const [info, user] = await Promise.all([
        BusinessInfo.findOne({ userId })
            .select('timezone defaultCurrency insightPushLastLocalDate insightPushFingerprint insightPushFingerprintLocalDate')
            .lean(),
        User.findById(userId).select('status').lean(),
    ]);
    if (!user || user.status === 'suspended') return 'skipped';

    const clock = getLocalClockInTimezone(info?.timezone, now);
    const currency = await getBusinessCurrencyForUser(userId);
    const [docs, lowStock, outOfStock] = await Promise.all([
        Invoice.find({ userId, status: { $ne: 'draft' } })
            .select(`date dueDate status total amountPaid documentType ${DOCUMENT_BOOKS_FIELDS}`)
            .lean(),
        findLowStockProductsForUser(userId),
        findOutOfStockProductsForUser(userId),
    ]);
    const stats = summarizeInvoices(projectDocsIntoBooks(docs, currency), info?.timezone, clock.localDate);
    const insight = chooseInsight({
        ...stats,
        lowOrOutCount: lowStock.length + outOfStock.length,
        currency: currency || info?.defaultCurrency,
    });
    if (!insight) return 'skipped';
    if (!shouldSendInsight({
        localHour: clock.hour,
        localDate: clock.localDate,
        lastSentLocalDate: info?.insightPushLastLocalDate,
        fingerprint: insight.fingerprint,
        previousFingerprint: info?.insightPushFingerprint,
        fingerprintLocalDate: info?.insightPushFingerprintLocalDate,
    })) {
        return 'skipped';
    }

    const claimed = await BusinessInfo.updateOne(
        {
            userId,
            insightPushLastLocalDate: { $ne: clock.localDate },
        },
        {
            $set: {
                insightPushLastLocalDate: clock.localDate,
                insightPushFingerprint: insight.fingerprint,
                insightPushFingerprintLocalDate: clock.localDate,
            },
        }
    );
    if (!claimed.modifiedCount) return 'skipped';

    try {
        await sendPushToSubscriptions(subscriptions, {
            title: insight.title,
            body: insight.body,
            url: insight.url,
            tag: insight.tag,
        });
        return 'sent';
    } catch (err) {
        console.error('[Waraqah Push] Insight briefing failed:', {
            userId,
            message: err?.message,
        });
        return 'skipped';
    }
}

export async function sendInsightPushes(now = new Date()) {
    if (!isPushConfigured()) return { processed: 0, skipped: 0 };
    let processed = 0;
    let skipped = 0;
    let lastUserId = null;

    while (true) {
        const match = lastUserId ? { userId: { $gt: lastUserId } } : {};
        const groups = await PushSubscription.aggregate([
            { $match: match },
            { $group: { _id: '$userId' } },
            { $sort: { _id: 1 } },
            { $limit: BATCH_SIZE },
        ]);
        if (groups.length === 0) break;
        lastUserId = groups[groups.length - 1]._id;

        for (const group of groups) {
            const subscriptions = await PushSubscription.find({ userId: group._id }).limit(20).lean();
            if (subscriptions.length === 0) {
                skipped += 1;
                continue;
            }
            const result = await sendInsightForUser(group._id, subscriptions, now);
            if (result === 'sent') processed += 1;
            else skipped += 1;
        }

        if (groups.length < BATCH_SIZE) break;
    }

    return { processed, skipped };
}
