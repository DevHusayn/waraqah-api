import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';

const SUMMARY_FIELDS =
    'invoiceNumber receiptNumber clientId date dueDate status total currency createdAt updatedAt';

function mapInvoiceSummary(doc) {
    return {
        ...doc,
        id: doc._id?.toString?.() || doc._id || doc.id,
    };
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
    const nonDraftFilter = { userId, status: { $ne: 'draft' } };

    const [statsRows, recentRaw, overdueRaw, draftCount, totalClients] = await Promise.all([
        Invoice.aggregate([
            { $match: nonDraftFilter },
            {
                $group: {
                    _id: null,
                    totalInvoices: { $sum: 1 },
                    paidRevenue: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'paid'] }, { $ifNull: ['$total', 0] }, 0],
                        },
                    },
                    pendingRevenue: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'pending'] }, { $ifNull: ['$total', 0] }, 0],
                        },
                    },
                },
            },
        ]),
        Invoice.find(nonDraftFilter)
            .select(SUMMARY_FIELDS)
            .sort({ createdAt: -1 })
            .limit(5)
            .lean(),
        Invoice.find({ userId, status: 'overdue' })
            .select(SUMMARY_FIELDS)
            .sort({ dueDate: 1 })
            .lean(),
        Invoice.countDocuments({ userId, status: 'draft' }),
        Client.countDocuments({ userId }),
    ]);

    const statsRow = statsRows[0] || {};
    const [recentInvoices, overdueInvoices] = await Promise.all([
        attachClientNames(recentRaw),
        attachClientNames(overdueRaw),
    ]);

    return {
        stats: {
            totalInvoices: statsRow.totalInvoices || 0,
            totalClients,
            paidRevenue: statsRow.paidRevenue || 0,
            pendingRevenue: statsRow.pendingRevenue || 0,
            draftCount,
        },
        recentInvoices,
        overdueInvoices,
    };
}

/** Lightweight counts for app shell (sidebar draft badge). */
export async function getInvoiceMetaForUser(userId) {
    const draftCount = await Invoice.countDocuments({ userId, status: 'draft' });
    return { draftCount };
}
