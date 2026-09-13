import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import Quotation from '../models/Quotation.js';
import Client from '../models/Client.js';
import Product from '../models/Product.js';
import { INVOICE_ONLY_FILTER, RECEIPT_ONLY_FILTER } from './invoiceDocumentFilter.js';
import { getBusinessTimezone, getYearMonthInTimezone, getUtcRangeForMonthInTimezone } from './timezone.js';
import { getStockHistory } from './stockLedger.js';
import {
    computeDocumentDiscountRatio,
    roundMoney,
} from './documentLineMath.js';
import {
    computePaidRatio,
    docCountsAsRealizedSale,
    scaleByPaidRatio,
} from './realizedSales.js';

function resolvePaymentMethod(doc) {
    if (Array.isArray(doc.payments) && doc.payments.length > 0) {
        const latest = doc.payments[doc.payments.length - 1];
        return latest?.method || doc.paymentMethod || null;
    }
    return doc.paymentMethod || null;
}

function extractMatchingItems(items, productId) {
    if (!Array.isArray(items)) return [];
    const target = String(productId);
    return items.filter((item) => item?.productId && String(item.productId) === target);
}

function sumMatchingLines(
    items,
    productId,
    catalogUnitCost = 0,
    discountRatio = 0,
    { trackInventory = true } = {}
) {
    const matches = extractMatchingItems(items, productId);
    let quantity = 0;
    let lineTotal = 0;
    let lineCogs = 0;

    for (const item of matches) {
        const qty = Number(item.quantity) || 0;
        const rate = Number(item.rate) || 0;
        const snapshotCost = Number(item.unitCost) || 0;
        const unitCost = snapshotCost > 0 ? snapshotCost : Number(catalogUnitCost) || 0;
        quantity += qty;
        lineTotal += qty * rate;
        lineCogs += qty * unitCost;
    }

    const adjustedLineTotal = roundMoney(lineTotal * (1 - discountRatio));
    const treatAsZeroCostService = !trackInventory && lineCogs <= 0;
    const adjustedLineProfit =
        lineCogs > 0 || treatAsZeroCostService
            ? roundMoney(adjustedLineTotal - lineCogs)
            : 0;

    return {
        quantity,
        lineTotal: roundMoney(lineTotal),
        adjustedLineTotal,
        lineCogs: roundMoney(lineCogs),
        adjustedLineProfit,
        matches,
    };
}

function resolveClientName(client, clientId) {
    if (client?.name) return client.name;
    if (clientId) return 'Client';
    return 'No client';
}

function resolveDocumentNumber(doc, documentType) {
    if (documentType === 'quotation') return doc.quotationNumber || '—';
    if (documentType === 'receipt') return doc.receiptNumber || doc.invoiceNumber || '—';
    return doc.invoiceNumber || '—';
}

function computeInvoiceLineUnpaidRatio(doc, documentType) {
    if (documentType !== 'invoice') return 0;

    const status = doc.status;
    if (status === 'pending' || status === 'overdue') return 1;

    if (status === 'partial') {
        const paidRatio = computePaidRatio(doc);
        return Math.max(0, 1 - paidRatio);
    }

    return 0;
}

function buildTransaction(
    doc,
    documentType,
    productId,
    clientMap,
    catalogUnitCost = 0,
    { trackInventory = true } = {}
) {
    const discountRatio =
        documentType === 'quotation' ? 0 : computeDocumentDiscountRatio(doc, doc.items);
    const sums = sumMatchingLines(doc.items, productId, catalogUnitCost, discountRatio, {
        trackInventory,
    });
    if (sums.quantity <= 0 && sums.lineTotal <= 0) return null;

    const countsAsSale = documentType !== 'quotation' && docCountsAsRealizedSale(doc);
    const paidRatio = countsAsSale ? computePaidRatio(doc) : 0;
    const saleMetrics = scaleByPaidRatio(
        sums.quantity,
        sums.adjustedLineTotal,
        sums.adjustedLineProfit,
        paidRatio
    );

    const unpaidRatio = computeInvoiceLineUnpaidRatio(doc, documentType);
    const pendingLineTotal = roundMoney(sums.adjustedLineTotal * unpaidRatio);
    const pendingQuantity = sums.quantity * unpaidRatio;

    const clientId = doc.clientId ? String(doc.clientId._id || doc.clientId) : null;
    const client = clientId ? clientMap.get(clientId) : null;

    return {
        id: String(doc._id),
        documentType,
        documentNumber: resolveDocumentNumber(doc, documentType),
        date: doc.date || null,
        clientId,
        clientName: resolveClientName(client, clientId),
        quantity: sums.quantity,
        lineTotal: sums.lineTotal,
        adjustedLineTotal: sums.adjustedLineTotal,
        lineProfit: sums.adjustedLineProfit,
        countsAsSale,
        saleQuantity: saleMetrics.quantity,
        saleLineTotal: saleMetrics.lineTotal,
        saleLineProfit: saleMetrics.lineProfit,
        pendingQuantity,
        pendingLineTotal,
        status: doc.status || null,
        paymentMethod: documentType === 'quotation' ? null : resolvePaymentMethod(doc),
    };
}

function upsertClientRollup(map, transaction) {
    if (!transaction.clientId || !transaction.countsAsSale) return;

    const existing = map.get(transaction.clientId) || {
        clientId: transaction.clientId,
        clientName: transaction.clientName,
        quantitySold: 0,
        revenue: 0,
        lastPurchaseDate: null,
        lastPaymentMethod: null,
    };

    existing.quantitySold += transaction.saleQuantity;
    existing.revenue += transaction.saleLineTotal;

    if (
        transaction.date
        && (!existing.lastPurchaseDate || transaction.date > existing.lastPurchaseDate)
    ) {
        existing.lastPurchaseDate = transaction.date;
        existing.lastPaymentMethod = transaction.paymentMethod;
    }

    map.set(transaction.clientId, existing);
}

function isSoldTransaction(documentType) {
    return documentType === 'invoice' || documentType === 'receipt';
}

const DOC_SELECT_FIELDS =
    'invoiceNumber receiptNumber date clientId items status paymentMethod payments total amountPaid discount discountType discountValue documentType';

/**
 * Aggregate catalog-linked sales activity for a product.
 */
export async function getProductActivity(userId, productId) {
    const product = await Product.findOne({ _id: productId, userId }).lean();
    if (!product) return null;

    const productObjectId = new mongoose.Types.ObjectId(productId);
    const itemFilter = { 'items.productId': productObjectId };

    const [invoices, receipts, quotations] = await Promise.all([
        Invoice.find({
            userId,
            ...INVOICE_ONLY_FILTER,
            ...itemFilter,
            status: { $nin: ['draft', 'cancelled'] },
        })
            .select(DOC_SELECT_FIELDS)
            .sort({ date: -1, createdAt: -1 })
            .lean(),
        Invoice.find({
            userId,
            ...RECEIPT_ONLY_FILTER,
            ...itemFilter,
            status: { $nin: ['draft', 'cancelled'] },
        })
            .select(DOC_SELECT_FIELDS)
            .sort({ date: -1, createdAt: -1 })
            .lean(),
        Quotation.find({
            userId,
            ...itemFilter,
            status: { $nin: ['draft', 'cancelled', 'rejected'] },
            convertedInvoiceId: null,
        })
            .select('quotationNumber date clientId items status')
            .sort({ date: -1, createdAt: -1 })
            .lean(),
    ]);

    const clientIds = new Set();
    for (const doc of [...invoices, ...receipts, ...quotations]) {
        if (doc.clientId) clientIds.add(String(doc.clientId));
    }

    const clients = clientIds.size
        ? await Client.find({ userId, _id: { $in: [...clientIds] } })
            .select('name email company')
            .lean()
        : [];

    const clientMap = new Map(clients.map((client) => [String(client._id), client]));

    const transactions = [];
    const clientRollup = new Map();

    const catalogUnitCost = product.unitCost ?? 0;
    const trackInventory = Boolean(product.trackInventory);

    for (const doc of invoices) {
        const row = buildTransaction(doc, 'invoice', productId, clientMap, catalogUnitCost, {
            trackInventory,
        });
        if (row) {
            transactions.push(row);
            if (row.countsAsSale) {
                upsertClientRollup(clientRollup, row);
            }
        }
    }

    for (const doc of receipts) {
        const row = buildTransaction(doc, 'receipt', productId, clientMap, catalogUnitCost, {
            trackInventory,
        });
        if (row) {
            transactions.push(row);
            if (row.countsAsSale) {
                upsertClientRollup(clientRollup, row);
            }
        }
    }

    for (const doc of quotations) {
        const row = buildTransaction(doc, 'quotation', productId, clientMap, catalogUnitCost, {
            trackInventory,
        });
        if (row) transactions.push(row);
    }

    transactions.sort((a, b) => {
        const dateA = a.date || '';
        const dateB = b.date || '';
        return dateB.localeCompare(dateA);
    });

    const timeZone = await getBusinessTimezone(userId);
    const { year, month } = getYearMonthInTimezone(timeZone);
    const { start, end } = getUtcRangeForMonthInTimezone(year, month, timeZone);
    const monthStart = start.toISOString().slice(0, 10);
    const monthEnd = end.toISOString().slice(0, 10);

    let totalQuantitySold = 0;
    let totalRevenue = 0;
    let soldThisMonthQty = 0;
    let soldThisMonthRevenue = 0;
    let pendingQuantity = 0;
    let pendingRevenue = 0;

    for (const row of transactions) {
        if (row.documentType === 'quotation') {
            continue;
        }

        if (row.pendingQuantity > 0) {
            pendingQuantity += row.pendingQuantity;
            pendingRevenue += row.pendingLineTotal;
        }

        if (!isSoldTransaction(row.documentType) || !row.countsAsSale) continue;

        totalQuantitySold += row.saleQuantity;
        totalRevenue += row.saleLineTotal;

        if (row.date && row.date >= monthStart && row.date < monthEnd) {
            soldThisMonthQty += row.saleQuantity;
            soldThisMonthRevenue += row.saleLineTotal;
        }
    }

    return {
        product: {
            id: String(product._id),
            name: product.name,
            description: product.description || '',
            unitPrice: product.unitPrice ?? 0,
            unitCost: product.unitCost ?? 0,
            trackInventory: Boolean(product.trackInventory),
            quantityOnHand: product.quantityOnHand ?? 0,
            lowStockThreshold: product.lowStockThreshold ?? null,
        },
        summary: {
            totalQuantitySold,
            totalRevenue: roundMoney(totalRevenue),
            uniqueClients: clientRollup.size,
            soldThisMonthQty,
            soldThisMonthRevenue: roundMoney(soldThisMonthRevenue),
            pendingQuantity,
            pendingRevenue: roundMoney(pendingRevenue),
        },
        byClient: [...clientRollup.values()]
            .map((row) => ({ ...row, revenue: roundMoney(row.revenue) }))
            .sort((a, b) => b.revenue - a.revenue),
        transactions,
        stockHistory: product.trackInventory
            ? await getStockHistory(userId, product._id)
            : [],
    };
}
