import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';
import { buildMonthlyStatement } from './monthlyStatementBuild.js';
import { buildIssueDateMonthFilter } from './listMonthFilter.js';
import { INVOICE_ONLY_FILTER, RECEIPT_ONLY_FILTER } from './invoiceDocumentFilter.js';
import {
    DOCUMENT_BOOKS_FIELDS,
    getBusinessCurrencyForUser,
    projectDocsIntoBooks,
} from './documentCurrency.js';

function mapDocument(doc) {
    return {
        id: String(doc._id),
        clientId: doc.clientId ? String(doc.clientId) : null,
        date: doc.date,
        status: doc.status,
        total: doc.total,
        amountPaid: doc.amountPaid,
        documentType: doc.documentType || 'invoice',
    };
}

function mapClient(doc) {
    return {
        id: String(doc._id),
        name: doc.name,
        email: doc.email,
        company: doc.company,
    };
}

export async function loadMonthlyStatementForUser(userId, year, month) {
    const dateFilter = buildIssueDateMonthFilter(year, month);
    if (!dateFilter) {
        throw new Error('Invalid statement month.');
    }

    const baseFilter = {
        userId,
        status: { $ne: 'draft' },
        ...dateFilter,
    };

    const [invoices, receipts, clients] = await Promise.all([
        Invoice.find({ ...baseFilter, ...INVOICE_ONLY_FILTER })
            .select(`clientId date status total amountPaid documentType ${DOCUMENT_BOOKS_FIELDS}`)
            .lean(),
        Invoice.find({ ...baseFilter, ...RECEIPT_ONLY_FILTER })
            .select(`clientId date status total amountPaid documentType ${DOCUMENT_BOOKS_FIELDS}`)
            .lean(),
        Client.find({ userId }).select('name email company').lean(),
    ]);

    const businessCurrency = await getBusinessCurrencyForUser(userId);

    return buildMonthlyStatement({
        invoices: projectDocsIntoBooks(invoices, businessCurrency).map(mapDocument),
        receipts: projectDocsIntoBooks(receipts, businessCurrency).map(mapDocument),
        clients: clients.map(mapClient),
        year,
        month,
    });
}
