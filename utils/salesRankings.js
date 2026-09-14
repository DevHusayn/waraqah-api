import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import Product from '../models/Product.js';
import Client from '../models/Client.js';
import {
    dateMatchesPeriod,
    formatAnalyticsPeriodLabel,
    normalizeTimezone,
} from './timezone.js';
import { computeDocumentDiscountRatio, roundMoney } from './documentLineMath.js';
import {
    amountPaidOf,
    computePaidRatio,
    docCountsAsRealizedSale,
} from './realizedSales.js';
import { isValidObjectId } from './sanitize.js';

export const DEFAULT_RANKING_LIMIT = 5;

const SALE_DOC_FIELDS =
    'date status total amountPaid documentType items discount discountType discountValue clientId clientName';

function toUserObjectId(userId) {
    if (userId instanceof mongoose.Types.ObjectId) return userId;
    return new mongoose.Types.ObjectId(String(userId));
}

function serializePeriod(period, timeZone) {
    const tz = normalizeTimezone(timeZone);
    const resolved = period && typeof period === 'object' ? period : { kind: 'all' };
    return {
        kind: resolved.kind || 'all',
        year: resolved.year,
        month: resolved.month,
        day: resolved.day,
        startYear: resolved.startYear,
        startMonth: resolved.startMonth,
        startDay: resolved.startDay,
        endYear: resolved.endYear,
        endMonth: resolved.endMonth,
        endDay: resolved.endDay,
        label: formatAnalyticsPeriodLabel(resolved, 'en-US', tz),
        timezone: tz,
    };
}

function docIsInPeriod(doc, period, timeZone) {
    return dateMatchesPeriod(doc?.date, period, timeZone);
}

function compareDesc(primary, secondary) {
    if (primary !== 0) return primary;
    return secondary;
}

export async function loadSaleDocsForUser(userId) {
    const uid = toUserObjectId(userId);
    return Invoice.find({ userId: uid, status: { $ne: 'draft' } })
        .select(SALE_DOC_FIELDS)
        .lean();
}

/**
 * Rank catalog products by quantity sold (then revenue) for realized sales in the period.
 */
export function rankBestSellingProducts(
    docs,
    { period, timeZone, limit = DEFAULT_RANKING_LIMIT, nameById = null } = {}
) {
    const tz = normalizeTimezone(timeZone);
    const byProduct = new Map();

    for (const doc of docs || []) {
        if (!docIsInPeriod(doc, period, tz)) continue;
        if (!docCountsAsRealizedSale(doc)) continue;

        const paidRatio = computePaidRatio(doc);
        if (paidRatio <= 0) continue;
        if (!Array.isArray(doc.items)) continue;

        const discountRatio = computeDocumentDiscountRatio(doc, doc.items);

        for (const item of doc.items) {
            if (!item?.productId) continue;

            const productId = String(item.productId);
            const qty = Number(item.quantity) || 0;
            const rate = Number(item.rate) || 0;
            const lineRevenue = roundMoney(qty * rate * (1 - discountRatio) * paidRatio);
            const existing = byProduct.get(productId) || {
                id: productId,
                name: item.description || 'Product',
                qtySold: 0,
                revenue: 0,
            };

            existing.qtySold += qty * paidRatio;
            existing.revenue += lineRevenue;
            if (item.description) existing.name = item.description;
            byProduct.set(productId, existing);
        }
    }

    const names = nameById instanceof Map ? nameById : null;

    return [...byProduct.values()]
        .map((row) => ({
            id: row.id,
            name: names?.get(row.id) || row.name,
            qtySold: roundMoney(row.qtySold),
            revenue: roundMoney(row.revenue),
        }))
        .sort((a, b) => compareDesc(b.qtySold - a.qtySold, b.revenue - a.revenue))
        .slice(0, Math.max(0, Number(limit) || DEFAULT_RANKING_LIMIT));
}

/**
 * Rank clients by paid revenue (then document count) for realized sales in the period.
 */
export function rankBestBuyingClients(docs, { period, timeZone, limit = DEFAULT_RANKING_LIMIT } = {}) {
    const tz = normalizeTimezone(timeZone);
    const byClient = new Map();

    for (const doc of docs || []) {
        if (!docIsInPeriod(doc, period, tz)) continue;
        if (!docCountsAsRealizedSale(doc)) continue;

        const clientId = doc.clientId ? String(doc.clientId) : null;
        const snapshotName = String(doc.clientName || '').trim();
        if (!clientId && !snapshotName) continue;

        const key = clientId ? `id:${clientId}` : `name:${snapshotName.toLowerCase()}`;
        const existing = byClient.get(key) || {
            id: clientId,
            name: snapshotName || 'Unknown Client',
            revenue: 0,
            documentCount: 0,
        };

        existing.revenue += amountPaidOf(doc);
        existing.documentCount += 1;
        if (snapshotName) existing.name = snapshotName;
        byClient.set(key, existing);
    }

    return [...byClient.values()]
        .map((row) => ({
            id: row.id,
            name: row.name,
            revenue: roundMoney(row.revenue),
            documentCount: row.documentCount,
        }))
        .sort((a, b) => compareDesc(b.revenue - a.revenue, b.documentCount - a.documentCount))
        .slice(0, Math.max(0, Number(limit) || DEFAULT_RANKING_LIMIT));
}

function toObjectIds(ids) {
    return [...new Set(ids.filter(Boolean).map(String))]
        .filter(isValidObjectId)
        .map((id) => new mongoose.Types.ObjectId(id));
}

async function loadProductNames(userId, docs) {
    const uid = toUserObjectId(userId);
    const productIds = new Set();
    for (const doc of docs) {
        for (const item of doc.items || []) {
            if (item?.productId) productIds.add(String(item.productId));
        }
    }
    const objectIds = toObjectIds([...productIds]);
    if (!objectIds.length) return new Map();

    const products = await Product.find({
        userId: uid,
        _id: { $in: objectIds },
    })
        .select('name')
        .lean();

    return new Map(products.map((product) => [String(product._id), product.name || 'Product']));
}

async function attachLiveClientNames(userId, items) {
    const uid = toUserObjectId(userId);
    const objectIds = toObjectIds(items.map((row) => row.id));
    if (!objectIds.length) {
        return items.map((row) => (row.id && !isValidObjectId(String(row.id)) ? { ...row, id: null } : row));
    }

    const clients = await Client.find({
        userId: uid,
        _id: { $in: objectIds },
    })
        .select('name')
        .lean();
    const nameById = new Map(clients.map((client) => [String(client._id), client.name || '']));
    const existingIds = new Set(nameById.keys());

    return items.map((row) => {
        if (!row.id) return row;
        if (!existingIds.has(String(row.id))) {
            return { ...row, id: null };
        }
        return {
            ...row,
            name: nameById.get(String(row.id)) || row.name,
        };
    });
}

export async function getTopSellingProductsForUser(userId, { period, timeZone, limit = DEFAULT_RANKING_LIMIT } = {}) {
    const docs = await loadSaleDocsForUser(userId);
    const nameById = await loadProductNames(userId, docs);
    return {
        period: serializePeriod(period, timeZone),
        items: rankBestSellingProducts(docs, { period, timeZone, limit, nameById }),
    };
}

export async function getTopBuyingClientsForUser(userId, { period, timeZone, limit = DEFAULT_RANKING_LIMIT } = {}) {
    const docs = await loadSaleDocsForUser(userId);
    const items = await attachLiveClientNames(
        userId,
        rankBestBuyingClients(docs, { period, timeZone, limit })
    );
    return {
        period: serializePeriod(period, timeZone),
        items,
    };
}
