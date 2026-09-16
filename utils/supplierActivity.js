import PurchaseOrder from '../models/PurchaseOrder.js';
import Supplier from '../models/Supplier.js';
import Product from '../models/Product.js';
import { getBusinessCurrencyForUser, projectDocIntoBooks } from './documentCurrency.js';

const OPEN_STATUSES = new Set(['sent', 'partial']);
const COUNTED_STATUSES = new Set(['sent', 'partial', 'received']);

function roundMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
}

function mapPurchaseOrderRow(doc) {
    return {
        id: String(doc._id),
        purchaseOrderNumber: doc.purchaseOrderNumber || '—',
        date: doc.date || null,
        expectedDate: doc.expectedDate || null,
        status: doc.status || 'draft',
        currency: doc.currency || 'NGN',
        total: roundMoney(doc.total),
        itemCount: Array.isArray(doc.items) ? doc.items.length : 0,
    };
}

function productRollupKey(item) {
    if (item?.productId) return `product:${String(item.productId)}`;
    const description = String(item?.description || '').trim().toLowerCase();
    return description ? `manual:${description}` : null;
}

function upsertProductRollup(map, item, orderDate) {
    const key = productRollupKey(item);
    if (!key) return;

    const ordered = Number(item.quantity) || 0;
    const received = Number(item.quantityReceived) || 0;
    const rate = Number(item.rate) || 0;
    const lineTotal = ordered * rate;

    const existing = map.get(key) || {
        key,
        productId: item.productId ? String(item.productId) : null,
        name: null,
        description: item.description || 'Line item',
        quantityOrdered: 0,
        quantityReceived: 0,
        lineTotal: 0,
        lastOrderDate: null,
    };

    existing.quantityOrdered += ordered;
    existing.quantityReceived += received;
    existing.lineTotal = roundMoney(existing.lineTotal + lineTotal);
    if (orderDate && (!existing.lastOrderDate || orderDate > existing.lastOrderDate)) {
        existing.lastOrderDate = orderDate;
    }

    map.set(key, existing);
}

export async function getSupplierActivity(userId, supplierId) {
    const supplier = await Supplier.findOne({ _id: supplierId, userId }).lean();
    if (!supplier) return null;

    const orders = await PurchaseOrder.find({
        userId,
        supplierId,
        status: { $ne: 'draft' },
    })
        .sort({ date: -1, createdAt: -1 })
        .lean();

    const businessCurrency = await getBusinessCurrencyForUser(userId);
    let openOrders = 0;
    let receivedOrders = 0;
    let cancelledOrders = 0;
    let totalOrderedValue = 0;
    const productRollup = new Map();

    for (const order of orders) {
        const status = order.status || 'draft';
        if (OPEN_STATUSES.has(status)) openOrders += 1;
        if (status === 'received') receivedOrders += 1;
        if (status === 'cancelled') cancelledOrders += 1;

        const booksOrder = projectDocIntoBooks(order, businessCurrency);
        if (COUNTED_STATUSES.has(status) && booksOrder) {
            totalOrderedValue += Number(booksOrder.total) || 0;
        }

        if (COUNTED_STATUSES.has(status) && booksOrder && Array.isArray(booksOrder.items)) {
            for (const item of booksOrder.items) {
                upsertProductRollup(productRollup, item, order.date || null);
            }
        }
    }

    const productIds = [...productRollup.values()]
        .map((row) => row.productId)
        .filter(Boolean);

    if (productIds.length > 0) {
        const products = await Product.find({ userId, _id: { $in: productIds } })
            .select('name')
            .lean();
        const nameById = new Map(products.map((p) => [String(p._id), p.name]));
        for (const row of productRollup.values()) {
            if (row.productId) {
                row.name = nameById.get(row.productId) || row.description;
            }
        }
    }

    const byProduct = [...productRollup.values()]
        .map((row) => ({
            ...row,
            lineTotal: roundMoney(row.lineTotal),
            displayName: row.name || row.description || 'Line item',
        }))
        .sort((a, b) => b.lineTotal - a.lineTotal);

    return {
        supplier: {
            id: String(supplier._id),
            name: supplier.name || '',
            company: supplier.company || '',
            email: supplier.email || '',
            phone: supplier.phone || '',
            address: supplier.address || '',
        },
        summary: {
            openOrders,
            receivedOrders,
            cancelledOrders,
            totalOrders: orders.length,
            totalOrderedValue: roundMoney(totalOrderedValue),
            uniqueProducts: byProduct.length,
        },
        purchaseOrders: orders.map(mapPurchaseOrderRow),
        byProduct,
    };
}
