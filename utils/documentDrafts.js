import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import Quotation from '../models/Quotation.js';
import Client from '../models/Client.js';
import { buildSearchFilter, escapeRegex } from './pagination.js';

function toUserObjectId(userId) {
    if (userId instanceof mongoose.Types.ObjectId) return userId;
    return new mongoose.Types.ObjectId(String(userId));
}

async function resolveSearchClientIds(userId, search) {
    const q = String(search || '').trim();
    if (!q) return [];
    const regex = new RegExp(escapeRegex(q), 'i');
    const clients = await Client.find({
        userId,
        $or: [{ name: regex }, { company: regex }, { email: regex }],
    })
        .select('_id')
        .lean();
    return clients.map((c) => c._id);
}

async function attachClientNames(docs, userId) {
    const clientIds = [
        ...new Set(
            docs
                .map((d) => d.clientId)
                .filter(Boolean)
                .map((id) => String(id))
        ),
    ];
    if (clientIds.length === 0) {
        return docs.map((d) => ({ ...d, clientName: null, clientCompany: null }));
    }
    const clients = await Client.find({
        userId,
        _id: { $in: clientIds },
    })
        .select('name company')
        .lean();
    const byId = new Map(clients.map((c) => [String(c._id), c]));
    return docs.map((d) => {
        const client = d.clientId ? byId.get(String(d.clientId)) : null;
        return {
            ...d,
            clientName: client?.name || null,
            clientCompany: client?.company || null,
        };
    });
}

function buildDraftFilter(userId, search, clientIds, numberFields) {
    const filter = { userId, status: 'draft' };
    if (!search) return filter;

    const textFilter = buildSearchFilter(search, numberFields);
    const or = [...(textFilter?.$or || [])];
    if (clientIds.length > 0) {
        or.push({ clientId: { $in: clientIds } });
    }
    if (or.length > 0) {
        filter.$or = or;
    }
    return filter;
}

/** Combined draft count for sidebar badge / meta. */
export async function getDraftCountForUser(userId) {
    const uid = toUserObjectId(userId);
    const [invoiceDrafts, quotationDrafts] = await Promise.all([
        Invoice.countDocuments({ userId: uid, status: 'draft' }),
        Quotation.countDocuments({ userId: uid, status: 'draft' }),
    ]);
    return invoiceDrafts + quotationDrafts;
}

/**
 * Merged invoice + quotation drafts, newest first.
 * Drafts are typically few, so fetch-then-slice is accurate for pagination.
 */
export async function getMergedDraftsForUser(userId, { skip = 0, limit = 20, search = '' } = {}) {
    const uid = toUserObjectId(userId);
    const q = String(search || '').trim();
    const clientIds = q ? await resolveSearchClientIds(uid, q) : [];

    const invoiceFilter = buildDraftFilter(uid, q, clientIds, [
        'invoiceNumber',
        'receiptNumber',
    ]);
    const quotationFilter = buildDraftFilter(uid, q, clientIds, ['quotationNumber']);

    const [invoiceRaw, quotationRaw] = await Promise.all([
        Invoice.find(invoiceFilter)
            .select('-items -notes')
            .sort({ updatedAt: -1 })
            .lean(),
        Quotation.find(quotationFilter)
            .select('-items -notes -terms')
            .sort({ updatedAt: -1 })
            .lean(),
    ]);

    const invoiceDocs = invoiceRaw.map((inv) => ({
        ...inv,
        documentType: 'invoice',
        id: inv._id?.toString?.() || inv._id,
    }));
    const quotationDocs = quotationRaw.map((qt) => ({
        ...qt,
        documentType: 'quotation',
        id: qt._id?.toString?.() || qt._id,
    }));

    const merged = [...invoiceDocs, ...quotationDocs].sort(
        (a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
    );

    const total = merged.length;
    const pageSlice = merged.slice(skip, skip + limit);
    const withClients = await attachClientNames(pageSlice, uid);

    return { data: withClients, total };
}
