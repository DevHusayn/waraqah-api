import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import Quotation from '../models/Quotation.js';
import Client from '../models/Client.js';
import { syncExpiredQuotationsForUser } from './quotationExpire.js';
import { getDraftCountForUser } from './documentDrafts.js';

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

function amountPaidOf(inv) {
    const recorded = roundMoney(inv.amountPaid);
    if (recorded > 0) return recorded;
    if (inv.status === 'paid') return roundMoney(inv.total);
    return 0;
}

function balanceDueOf(inv) {
    return Math.max(0, roundMoney(inv.total) - amountPaidOf(inv));
}

/** Collected cash across all invoices (uses amountPaid when present). */
function sumCollectedRevenue(invoices) {
    return invoices.reduce((sum, inv) => {
        if (inv.status === 'cancelled' || inv.status === 'draft') return sum;
        return sum + amountPaidOf(inv);
    }, 0);
}

/** Outstanding balances for unpaid / partial / overdue invoices. */
function sumOutstandingRevenue(invoices) {
    return invoices.reduce((sum, inv) => {
        if (!['pending', 'partial', 'overdue'].includes(inv.status)) return sum;
        return sum + balanceDueOf(inv);
    }, 0);
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
            clientName: clientId ? nameById[clientId] || 'Unknown Client' : 'Unknown Client',
        };
    });
}

/** Aggregated dashboard payload — avoids loading the full invoice list on home. */
export async function getDashboardForUser(userId) {
    await syncExpiredQuotationsForUser(userId);
    const uid = toUserObjectId(userId);
    const nonDraftFilter = { userId: uid, status: { $ne: 'draft' } };

    const [
        statsSource,
        recentInvoicesRaw,
        recentQuotationsRaw,
        overdueRaw,
        draftCount,
        totalClients,
        totalQuotations,
    ] = await Promise.all([
        Invoice.find(nonDraftFilter).select('status total amountPaid').lean(),
        Invoice.find(nonDraftFilter)
            .select(INVOICE_SUMMARY_FIELDS)
            .sort({ createdAt: -1 })
            .limit(5)
            .lean(),
        Quotation.find(nonDraftFilter)
            .select(QUOTATION_SUMMARY_FIELDS)
            .sort({ createdAt: -1 })
            .limit(5)
            .lean(),
        Invoice.find({ userId: uid, status: 'overdue' })
            .select(INVOICE_SUMMARY_FIELDS)
            .sort({ dueDate: 1 })
            .lean(),
        getDraftCountForUser(userId),
        Client.countDocuments({ userId: uid }),
        Quotation.countDocuments(nonDraftFilter),
    ]);

    const invoiceDocs = recentInvoicesRaw.map((inv) => ({
        ...inv,
        documentType: 'invoice',
        displayNumber: inv.invoiceNumber || '',
    }));
    const quotationDocs = recentQuotationsRaw.map((q) => ({
        ...q,
        documentType: 'quotation',
        displayNumber: q.quotationNumber || '',
    }));

    const mergedRecent = [...invoiceDocs, ...quotationDocs]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5);

    const [recentDocuments, overdueInvoices] = await Promise.all([
        attachClientNames(mergedRecent),
        attachClientNames(overdueRaw),
    ]);

    // Keep recentInvoices for backward compatibility with older clients
    const recentInvoices = recentDocuments.filter((d) => d.documentType === 'invoice');

    return {
        stats: {
            totalInvoices: statsSource.length,
            totalQuotations,
            totalClients,
            paidRevenue: sumCollectedRevenue(statsSource),
            pendingRevenue: sumOutstandingRevenue(statsSource),
            draftCount,
        },
        recentDocuments,
        recentInvoices,
        overdueInvoices,
    };
}

/** Lightweight counts for app shell (sidebar draft badge). */
export async function getInvoiceMetaForUser(userId) {
    const draftCount = await getDraftCountForUser(userId);
    return { draftCount };
}
