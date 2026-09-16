import Invoice from '../models/Invoice.js';
import Quotation from '../models/Quotation.js';
import Client from '../models/Client.js';
import Product from '../models/Product.js';
import { INVOICE_ONLY_FILTER, RECEIPT_ONLY_FILTER } from './invoiceDocumentFilter.js';
import { computePaidRevenue, computePendingBalance } from './dashboardStats.js';
import { computePaidRatio, docCountsAsRealizedSale } from './realizedSales.js';
import { computeDocumentDiscountRatio, roundMoney } from './documentLineMath.js';
import {
    DOCUMENT_BOOKS_FIELDS,
    getBusinessCurrencyForUser,
    projectDocIntoBooks,
} from './documentCurrency.js';

function resolveDocumentNumber(doc, documentType) {
    if (documentType === 'quotation') return doc.quotationNumber || '—';
    if (documentType === 'receipt') return doc.receiptNumber || doc.invoiceNumber || '—';
    return doc.invoiceNumber || '—';
}

function mapDocumentRow(doc, documentType) {
    const total = roundMoney(doc.total);
    const amountPaid = documentType === 'quotation' ? 0 : roundMoney(computePaidRevenue(doc));
    const balanceDue = documentType === 'quotation' ? 0 : roundMoney(computePendingBalance(doc));

    return {
        id: String(doc._id),
        documentType,
        documentNumber: resolveDocumentNumber(doc, documentType),
        date: doc.date || null,
        status: doc.status || null,
        currency: doc.currency || 'NGN',
        total,
        amountPaid,
        balanceDue,
    };
}

function productRollupKey(item) {
    if (item?.productId) return `product:${String(item.productId)}`;
    const description = String(item?.description || '').trim().toLowerCase();
    return description ? `manual:${description}` : null;
}

function upsertProductRollup(map, item, docDate, paidRatio = 1, discountRatio = 0) {
    const key = productRollupKey(item);
    if (!key) return;

    const ratio = Number(paidRatio) || 0;
    if (ratio <= 0) return;

    const quantity = (Number(item.quantity) || 0) * ratio;
    const rate = Number(item.rate) || 0;
    const lineTotal = roundMoney(quantity * rate * (1 - discountRatio));

    const existing = map.get(key) || {
        key,
        productId: item.productId ? String(item.productId) : null,
        name: null,
        description: item.description || 'Line item',
        quantitySold: 0,
        lineTotal: 0,
        lastPurchaseDate: null,
    };

    existing.quantitySold += quantity;
    existing.lineTotal = roundMoney(existing.lineTotal + lineTotal);
    if (docDate && (!existing.lastPurchaseDate || docDate > existing.lastPurchaseDate)) {
        existing.lastPurchaseDate = docDate;
    }

    map.set(key, existing);
}

function addDocumentItemsToRollup(map, doc) {
    if (!docCountsAsRealizedSale(doc)) return;
    const paidRatio = computePaidRatio(doc);
    const discountRatio = computeDocumentDiscountRatio(doc, doc.items);
    if (!Array.isArray(doc.items)) return;
    for (const item of doc.items) {
        upsertProductRollup(map, item, doc.date || null, paidRatio, discountRatio);
    }
}

const DOC_SELECT_FIELDS =
    `invoiceNumber receiptNumber date status total amountPaid currency items documentType discount discountType discountValue ${DOCUMENT_BOOKS_FIELDS}`;

export async function getClientActivity(userId, clientId) {
    const client = await Client.findOne({ _id: clientId, userId }).lean();
    if (!client) return null;

    const inactiveDocStatuses = ['draft', 'cancelled'];
    const inactiveQuotationStatuses = ['draft', 'cancelled', 'rejected'];

    const [invoices, receipts, quotations] = await Promise.all([
        Invoice.find({
            userId,
            clientId,
            ...INVOICE_ONLY_FILTER,
            status: { $nin: inactiveDocStatuses },
        })
            .select(DOC_SELECT_FIELDS)
            .sort({ date: -1, createdAt: -1 })
            .lean(),
        Invoice.find({
            userId,
            clientId,
            ...RECEIPT_ONLY_FILTER,
            status: { $nin: inactiveDocStatuses },
        })
            .select(DOC_SELECT_FIELDS)
            .sort({ date: -1, createdAt: -1 })
            .lean(),
        Quotation.find({
            userId,
            clientId,
            status: { $nin: inactiveQuotationStatuses },
        })
            .select(`quotationNumber date status total currency items convertedInvoiceId ${DOCUMENT_BOOKS_FIELDS}`)
            .sort({ date: -1, createdAt: -1 })
            .lean(),
    ]);

    const documents = [];
    const productRollup = new Map();
    const businessCurrency = await getBusinessCurrencyForUser(userId);

    let totalInvoiced = 0;
    let totalPaid = 0;
    let outstanding = 0;
    let invoiceCount = 0;
    let receiptCount = 0;
    let quotationCount = 0;

    for (const doc of invoices) {
        documents.push(mapDocumentRow(doc, 'invoice'));
        invoiceCount += 1;
        const booksDoc = projectDocIntoBooks(doc, businessCurrency);
        if (booksDoc) {
            totalInvoiced += roundMoney(booksDoc.total);
            totalPaid += computePaidRevenue(booksDoc);
            outstanding += computePendingBalance(booksDoc);
            addDocumentItemsToRollup(productRollup, booksDoc);
        }
    }

    for (const doc of receipts) {
        documents.push(mapDocumentRow(doc, 'receipt'));
        receiptCount += 1;
        const booksDoc = projectDocIntoBooks(doc, businessCurrency);
        if (booksDoc) {
            totalInvoiced += roundMoney(booksDoc.total);
            totalPaid += computePaidRevenue(booksDoc);
            outstanding += computePendingBalance(booksDoc);
            addDocumentItemsToRollup(productRollup, booksDoc);
        }
    }

    for (const doc of quotations) {
        documents.push(mapDocumentRow(doc, 'quotation'));
        quotationCount += 1;
    }

    documents.sort((a, b) => {
        const dateA = a.date || '';
        const dateB = b.date || '';
        return dateB.localeCompare(dateA);
    });

    const productIds = [...productRollup.values()]
        .map((row) => row.productId)
        .filter(Boolean);

    if (productIds.length > 0) {
        const products = await Product.find({ userId, _id: { $in: productIds } })
            .select('name')
            .lean();
        const nameById = new Map(products.map((product) => [String(product._id), product.name]));
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
        client: {
            id: String(client._id),
            name: client.name || '',
            company: client.company || '',
            email: client.email || '',
            phone: client.phone || '',
            address: client.address || '',
        },
        summary: {
            totalInvoiced: roundMoney(totalInvoiced),
            totalPaid: roundMoney(totalPaid),
            outstanding: roundMoney(outstanding),
            invoiceCount,
            receiptCount,
            quotationCount,
            totalDocuments: documents.length,
            uniqueProducts: byProduct.length,
        },
        documents,
        byProduct,
    };
}
