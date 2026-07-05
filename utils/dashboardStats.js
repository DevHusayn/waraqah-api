import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';

const SUMMARY_FIELDS =
    'invoiceNumber receiptNumber clientId date dueDate status total currency createdAt updatedAt';

function toUserObjectId(userId) {
    if (userId instanceof mongoose.Types.ObjectId) return userId;
    return new mongoose.Types.ObjectId(String(userId));
}

function mapInvoiceSummary(doc) {
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

async function attachClientNames(invoices) {
    if (!invoices.length) return [];

    const clientIds = [
        ...new Set(invoices.map((inv) => inv.clientId?.toString?.() || inv.clientId).filter(Boolean)),
    ];
    const clients = clientIds.length
        ? await Client.find({ _id: { $in: clientIds } }).select('name').lean()
        : [];
    const nameById = Object.fromEntries(
        clients.map((client) => [client._id.toString(), client.name || ''])
    );

    return invoices.map((inv) => {
        const mapped = mapInvoiceSummary(inv);
        const clientId = inv.clientId?.toString?.() || inv.clientId || null;
        return {
            ...mapped,
            clientName: clientId ? nameById[clientId] || 'Unknown Client' : 'Unknown Client',
        };
    });
}

/** Aggregated dashboard payload — avoids loading the full invoice list on home. */
export async function getDashboardForUser(userId) {
    const uid = toUserObjectId(userId);
    const nonDraftFilter = { userId: uid, status: { $ne: 'draft' } };

    const [statsSource, recentRaw, overdueRaw, draftCount, totalClients] = await Promise.all([
        Invoice.find(nonDraftFilter).select('status total').lean(),
        Invoice.find(nonDraftFilter)
            .select(SUMMARY_FIELDS)
            .sort({ createdAt: -1 })
            .limit(5)
            .lean(),
        Invoice.find({ userId: uid, status: 'overdue' })
            .select(SUMMARY_FIELDS)
            .sort({ dueDate: 1 })
            .lean(),
        Invoice.countDocuments({ userId: uid, status: 'draft' }),
        Client.countDocuments({ userId: uid }),
    ]);

    const [recentInvoices, overdueInvoices] = await Promise.all([
        attachClientNames(recentRaw),
        attachClientNames(overdueRaw),
    ]);

    return {
        stats: {
            totalInvoices: statsSource.length,
            totalClients,
            paidRevenue: sumRevenueForStatus(statsSource, 'paid'),
            pendingRevenue: sumRevenueForStatus(statsSource, 'pending'),
            draftCount,
        },
        recentInvoices,
        overdueInvoices,
    };
}

/** Lightweight counts for app shell (sidebar draft badge). */
export async function getInvoiceMetaForUser(userId) {
    const uid = toUserObjectId(userId);
    const draftCount = await Invoice.countDocuments({ userId: uid, status: 'draft' });
    return { draftCount };
}
