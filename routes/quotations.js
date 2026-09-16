import express from 'express';
import Quotation from '../models/Quotation.js';
import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';
import auth from '../middleware/auth.js';
import requireEmailVerified from '../middleware/requireEmailVerified.js';
import validateObjectId from '../middleware/validateObjectId.js';
import {
    getInvoiceUsageForUser,
    reserveInvoiceCreation,
    releaseInvoiceCreation,
} from '../utils/invoiceLimits.js';
import { getNextQuotationNumber } from '../utils/quotationNumber.js';
import { getNextInvoiceNumber } from '../utils/invoiceNumber.js';
import {
    normalizeQuotationPayload,
    assignQuotationNumber,
    isFinalizingDraft,
    isDraftStatus,
    assertQuotationDeleteAllowed,
    assertQuotationConvertible,
    DEFAULT_QUOTATION_TERMS,
} from '../utils/quotationValidation.js';
import { stripPremiumDocumentFooter } from '../utils/invoiceValidation.js';
import { isUserPremium } from '../utils/premiumAccess.js';
import { attachQuotationPublicTokenIfNeeded } from '../utils/quotationPublicToken.js';
import { attachPublicTokenIfNeeded } from '../utils/invoicePublicToken.js';
import {
    applyInventoryTransition,
    checkStockWarnings,
    getAllowOverselling,
} from '../utils/inventory.js';
import { syncExpiredQuotationsForUser } from '../utils/quotationExpire.js';
import {
    dispatchQuotationEmailToClient,
    tryAutoEmailQuotation,
    getEmailErrorMessage,
} from '../src/emails/index.js';
import asyncHandler from '../middleware/asyncHandler.js';
import mongoose from 'mongoose';
import {
    parsePagination,
    paginateFind,
    buildPaginationMeta,
    buildSearchFilter,
    escapeRegex,
} from '../utils/pagination.js';
import { countListSummary, buildSummaryResponse, resolveListSummaryOptions, isSummaryOnlyRequest, shouldFetchListSummary } from '../utils/listSummary.js';
import { getListPeriodMongoFilter } from '../utils/listMonthFilter.js';
import { sendQuotationListExport } from '../utils/quotationListExport.js';
import { applyClientSnapshot, DOCUMENT_CLIENT_SEARCH_FIELDS } from '../utils/clientSnapshot.js';
import { attachDocumentBaseAmounts } from '../utils/documentCurrency.js';
import { attachClientNamesToDocuments, attachClientNamesToDocument } from '../utils/attachClientNames.js';

const router = express.Router();

const QUOTATION_SORT = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    validUntil: { validUntil: 1 },
    amountHigh: { total: -1 },
    amountLow: { total: 1 },
};

function toUserObjectId(userId) {
    if (userId instanceof mongoose.Types.ObjectId) return userId;
    return new mongoose.Types.ObjectId(String(userId));
}

async function attachClientNames(quotations, userId) {
    return attachClientNamesToDocuments(quotations, userId);
}

async function getQuotationStatusCounts(userId, extraMatch = {}) {
    const uid = toUserObjectId(userId);
    const rows = await Quotation.aggregate([
        { $match: { userId: uid, status: { $ne: 'draft' }, ...extraMatch } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const statusCounts = {
        all: 0,
        sent: 0,
        accepted: 0,
        rejected: 0,
        expired: 0,
        converted: 0,
    };
    for (const row of rows) {
        const key = row._id;
        if (key && Object.prototype.hasOwnProperty.call(statusCounts, key)) {
            statusCounts[key] = row.count;
        }
        statusCounts.all += row.count;
    }
    return statusCounts;
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

router.get('/usage', auth, async (req, res) => {
    try {
        const usage = await getInvoiceUsageForUser(req.user.userId);
        res.json(usage);
    } catch (err) {
        res.status(500).json({ message: err.message || 'Could not load usage' });
    }
});

router.get('/next-number', auth, async (req, res) => {
    try {
        const quotationNumber = await getNextQuotationNumber(req.user.userId);
        res.json({ quotationNumber });
    } catch (err) {
        res.status(500).json({ message: err.message || 'Could not generate quotation number' });
    }
});

router.get('/export', auth, asyncHandler(async (req, res) => {
    await sendQuotationListExport(req, res);
}));

router.get('/', auth, asyncHandler(async (req, res) => {
    await syncExpiredQuotationsForUser(req.user.userId);

    const userId = req.user.userId;

    if (isSummaryOnlyRequest(req.query)) {
        const listBase = { userId, status: { $ne: 'draft' } };
        const summaryOpts = await resolveListSummaryOptions(req, userId);
        const summaryCounts = await countListSummary(Quotation, listBase, summaryOpts);
        return res.json({
            summary: buildSummaryResponse('totalQuotations', summaryCounts.total, summaryCounts),
        });
    }

    const { page, limit, skip } = parsePagination(req);
    const status = String(req.query.status || 'all').trim().toLowerCase();
    const sortKey = String(req.query.sort || 'newest').trim();
    const sort = QUOTATION_SORT[sortKey] || QUOTATION_SORT.newest;
    const search = String(req.query.search || '').trim();
    const dateFilter = await getListPeriodMongoFilter(req.query, userId);

    const filter = { userId, status: { $ne: 'draft' } };
    if (status && status !== 'all') {
        filter.status = status;
    }

    if (dateFilter) {
        Object.assign(filter, dateFilter);
    }

    if (search) {
        const clientIds = await resolveSearchClientIds(userId, search);
        const textFilter = buildSearchFilter(search, ['quotationNumber', ...DOCUMENT_CLIENT_SEARCH_FIELDS]);
        const or = [...(textFilter?.$or || [])];
        if (clientIds.length > 0) {
            or.push({ clientId: { $in: clientIds } });
        }
        if (or.length > 0) {
            filter.$or = or;
        }
    }

    const listBase = { userId, status: { $ne: 'draft' } };
    const includeSummary = shouldFetchListSummary(req.query);
    const summaryOpts = includeSummary ? await resolveListSummaryOptions(req, userId) : null;

    const [{ data, total }, statusCounts, summaryCounts] = await Promise.all([
        paginateFind(Quotation, filter, {
            skip,
            limit,
            sort,
            select: '-items -notes -terms',
            lean: true,
        }),
        getQuotationStatusCounts(userId, dateFilter || {}),
        includeSummary
            ? countListSummary(Quotation, listBase, summaryOpts)
            : Promise.resolve(null),
    ]);

    const withClients = await attachClientNames(data, userId);
    res.json({
        data: withClients,
        pagination: buildPaginationMeta(page, limit, total),
        statusCounts,
        ...(summaryCounts
            ? { summary: buildSummaryResponse('totalQuotations', summaryCounts.total, summaryCounts) }
            : {}),
    });
}));

router.get('/drafts', auth, asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const { page, limit, skip } = parsePagination(req);
    const search = String(req.query.search || '').trim();

    const filter = { userId, status: 'draft' };
    if (search) {
        const clientIds = await resolveSearchClientIds(userId, search);
        const textFilter = buildSearchFilter(search, ['quotationNumber', ...DOCUMENT_CLIENT_SEARCH_FIELDS]);
        const or = [...(textFilter?.$or || [])];
        if (clientIds.length > 0) {
            or.push({ clientId: { $in: clientIds } });
        }
        if (or.length > 0) {
            filter.$or = or;
        }
    }

    const { data, total } = await paginateFind(Quotation, filter, {
        skip,
        limit,
        sort: { updatedAt: -1 },
        select: '-items -notes -terms',
        lean: true,
    });

    const withClients = await attachClientNames(data, userId);
    res.json({
        data: withClients,
        pagination: buildPaginationMeta(page, limit, total),
    });
}));

router.post('/', auth, requireEmailVerified, async (req, res) => {
    let reserved = false;
    const isDraft = isDraftStatus(req.body?.status);
    try {
        if (!isDraft) {
            await reserveInvoiceCreation(req.user.userId);
            reserved = true;
        }
        const normalized = normalizeQuotationPayload(req.body, { isCreate: true });
        stripPremiumDocumentFooter(normalized, await isUserPremium(req.user.userId));
        await applyClientSnapshot(normalized, req.user.userId);
        const payload = await assignQuotationNumber(normalized, null, req.user.userId);
        attachQuotationPublicTokenIfNeeded(payload);
        await attachDocumentBaseAmounts(req.user.userId, payload);
        const quotation = await Quotation.create({
            ...payload,
            userId: req.user.userId,
        });
        if (!isDraft) {
            await tryAutoEmailQuotation({ quotation, userId: req.user.userId });
        }
        res.status(201).json(quotation);
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        if (err.code === 'INVOICE_LIMIT_REACHED') {
            return res.status(403).json({
                message: err.message,
                code: err.code,
                usage: err.usage,
            });
        }
        if (reserved) {
            await releaseInvoiceCreation(req.user.userId);
        }
        res.status(500).json({ message: err.message || 'Could not create quotation' });
    }
});

router.get('/:id', auth, validateObjectId(), asyncHandler(async (req, res) => {
    await syncExpiredQuotationsForUser(req.user.userId);
    const quotation = await Quotation.findOne({
        _id: req.params.id,
        userId: req.user.userId,
    });
    if (!quotation) return res.status(404).json({ message: 'Quotation not found' });
    res.json(await attachClientNamesToDocument(quotation, req.user.userId));
}));

router.put('/:id', auth, requireEmailVerified, validateObjectId(), async (req, res) => {
    let reserved = false;
    try {
        const existing = await Quotation.findOne({
            _id: req.params.id,
            userId: req.user.userId,
        });
        if (!existing) return res.status(404).json({ message: 'Quotation not found' });

        const normalized = normalizeQuotationPayload(req.body, { existing });
        stripPremiumDocumentFooter(normalized, await isUserPremium(req.user.userId));
        await applyClientSnapshot(normalized, req.user.userId, existing);
        if (isFinalizingDraft(existing, normalized)) {
            await reserveInvoiceCreation(req.user.userId);
            reserved = true;
        }

        const payload = await assignQuotationNumber(normalized, existing, req.user.userId);
        attachQuotationPublicTokenIfNeeded(payload, existing);
        await attachDocumentBaseAmounts(req.user.userId, payload);

        // Avoid wiping fields on partial updates (e.g. status-only accept/reject).
        const update = Object.fromEntries(
            Object.entries(payload).filter(([, value]) => value !== undefined)
        );

        const quotation = await Quotation.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.userId },
            update,
            { new: true }
        );

        if (isFinalizingDraft(existing, normalized)) {
            await tryAutoEmailQuotation({ quotation, userId: req.user.userId });
        }

        res.json(quotation);
    } catch (err) {
        if (reserved) {
            await releaseInvoiceCreation(req.user.userId);
        }
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        if (err.code === 'INVOICE_LIMIT_REACHED') {
            return res.status(403).json({
                message: err.message,
                code: err.code,
                usage: err.usage,
            });
        }
        res.status(500).json({ message: err.message || 'Could not update quotation' });
    }
});

router.delete('/:id', auth, requireEmailVerified, validateObjectId(), async (req, res) => {
    try {
        const existing = await Quotation.findOne({
            _id: req.params.id,
            userId: req.user.userId,
        });
        if (!existing) return res.status(404).json({ message: 'Quotation not found' });
        assertQuotationDeleteAllowed(existing);
        await Quotation.deleteOne({ _id: existing._id, userId: req.user.userId });
        res.json({ message: 'Quotation deleted' });
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        res.status(500).json({ message: err.message || 'Could not delete quotation' });
    }
});

router.post('/:id/send-email', auth, requireEmailVerified, validateObjectId(), async (req, res) => {
    try {
        const quotation = await Quotation.findOne({
            _id: req.params.id,
            userId: req.user.userId,
        });
        if (!quotation) return res.status(404).json({ message: 'Quotation not found' });
        if (quotation.status === 'draft') {
            return res.status(400).json({
                message: 'Finalize the quotation before emailing it to a client.',
            });
        }

        const result = await dispatchQuotationEmailToClient({
            quotation,
            userId: req.user.userId,
            notifyOwner: true,
            automated: false,
        });

        res.json({
            message: 'Quotation email sent.',
            sentTo: result.sentTo,
            publicUrl: result.publicUrl,
        });
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        console.error('Send quotation email error:', err);
        return res.status(503).json({ message: getEmailErrorMessage(err) });
    }
});

/** Convert quotation → new invoice (does not consume a second quota slot). */
router.post('/:id/convert', auth, requireEmailVerified, validateObjectId(), async (req, res) => {
    try {
        const quotation = await Quotation.findOne({
            _id: req.params.id,
            userId: req.user.userId,
        });
        if (!quotation) return res.status(404).json({ message: 'Quotation not found' });
        assertQuotationConvertible(quotation);

        const invoiceNumber = await getNextInvoiceNumber(req.user.userId);
        const today = new Date().toISOString().slice(0, 10);

        const invoicePayload = {
            userId: req.user.userId,
            clientId: quotation.clientId,
            clientName: quotation.clientName || null,
            clientCompany: quotation.clientCompany || null,
            invoiceNumber,
            date: today,
            dueDate: quotation.validUntil || null,
            items: (quotation.items || []).map((item) => ({
                description: item.description,
                quantity: item.quantity,
                rate: item.rate,
                unit: item.unit || 'Qty',
                productId: item.productId || null,
            })),
            notes: quotation.notes || '',
            documentFooter: quotation.documentFooter || '',
            clientAdditionalInfo: quotation.clientAdditionalInfo || '',
            status: 'pending',
            currency: quotation.currency,
            taxRate: quotation.taxRate ?? 0,
            discountType: quotation.discountType || 'fixed',
            discountValue: quotation.discountValue ?? 0,
            discount: quotation.discount ?? 0,
            subtotal: quotation.subtotal ?? 0,
            tax: quotation.tax ?? 0,
            total: quotation.total ?? 0,
            sourceQuotationId: quotation._id,
            exchangeRate: quotation.exchangeRate,
            baseCurrency: quotation.baseCurrency,
            baseSubtotal: quotation.baseSubtotal,
            baseTax: quotation.baseTax,
            baseDiscount: quotation.baseDiscount,
            baseTotal: quotation.baseTotal,
            baseAmountPaid: 0,
        };
        await applyClientSnapshot(invoicePayload, req.user.userId);
        await attachDocumentBaseAmounts(req.user.userId, invoicePayload);
        const invoice = await Invoice.create(invoicePayload);

        const tokenPayload = { status: 'pending' };
        attachPublicTokenIfNeeded(tokenPayload);
        invoice.publicToken = tokenPayload.publicToken;
        await invoice.save();

        const allowOverselling = await getAllowOverselling(req.user.userId);
        const stockWarnings = allowOverselling
            ? await checkStockWarnings(req.user.userId, {
                prevDoc: null,
                nextDoc: invoice,
            })
            : [];
        await applyInventoryTransition({
            userId: req.user.userId,
            prevDoc: null,
            nextDoc: invoice,
            allowOverselling,
        });

        quotation.status = 'converted';
        quotation.convertedInvoiceId = invoice._id;
        quotation.convertedAt = new Date();
        await quotation.save();

        res.status(201).json({
            quotation,
            invoice: stockWarnings.length ? { ...invoice.toObject(), stockWarnings } : invoice,
        });
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        console.error('Convert quotation error:', err);
        res.status(500).json({ message: err.message || 'Could not convert quotation' });
    }
});

export default router;
export { DEFAULT_QUOTATION_TERMS };
