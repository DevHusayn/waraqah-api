import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import Quotation from '../models/Quotation.js';
import Client from '../models/Client.js';
import { syncExpiredQuotationsForUser } from './quotationExpire.js';
import { getDraftCountForUser } from './documentDrafts.js';

const INVOICE_SUMMARY_FIELDS =
    'invoiceNumber receiptNumber clientId date dueDate status total currency createdAt updatedAt';
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

function sumRevenueForStatus(invoices, status) {
    return invoices.reduce((sum, inv) => {
        if (inv.status !== status) return sum;
        return sum + (Number(inv.total) || 0);
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
        Invoice.find(nonDraftFilter).select('status total').lean(),
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
            paidRevenue: sumRevenueForStatus(statsSource, 'paid'),
            pendingRevenue: sumRevenueForStatus(statsSource, 'pending'),
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
