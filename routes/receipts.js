import express from 'express';
import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';
import auth from '../middleware/auth.js';
import requireEmailVerified from '../middleware/requireEmailVerified.js';
import validateObjectId from '../middleware/validateObjectId.js';
import {
    reserveInvoiceCreation,
    releaseInvoiceCreation,
} from '../utils/invoiceLimits.js';
import { getNextReceiptNumber, peekNextReceiptNumber } from '../utils/receiptNumber.js';
import {
    normalizeReceiptPayload,
    assignReceiptNumbers,
    isFinalizingReceiptDraft,
    isDraftStatus,
    assertReceiptDeleteAllowed,
    applyReceiptPaymentLedger,
    resolveReceiptPaymentAmount,
    isReceiptDocument,
    applyReceiptPayment,
    buildReceiptPartialFilter,
    buildReceiptFullFilter,
} from '../utils/receiptValidation.js';
import { stripPremiumDocumentFooter } from '../utils/invoiceValidation.js';
import { isUserPremium } from '../utils/premiumAccess.js';
import { getReceiptPaymentStatusCounts } from '../utils/receiptCounts.js';
import { getListPeriodMongoFilter } from '../utils/listMonthFilter.js';
import { RECEIPT_ONLY_FILTER } from '../utils/invoiceDocumentFilter.js';
import { attachPublicTokenIfNeeded } from '../utils/invoicePublicToken.js';
import {
    dispatchReceiptEmailToClient,
    tryAutoEmailReceipt,
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
import { sendReceiptListExport } from '../utils/receiptListExport.js';
import { applyClientSnapshot, DOCUMENT_CLIENT_SEARCH_FIELDS } from '../utils/clientSnapshot.js';
import { attachDocumentBaseAmounts } from '../utils/documentCurrency.js';
import { attachClientNamesToDocuments } from '../utils/attachClientNames.js';
import {
    applyInventoryTransition,
    checkStockWarnings,
    getAllowOverselling,
    withStockWarnings,
} from '../utils/inventory.js';
import { snapshotItemUnitCosts } from '../utils/itemCostSnapshot.js';

const router = express.Router();

const PAID = 'paid';

const RECEIPT_SORT = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    amountHigh: { total: -1 },
    amountLow: { total: 1 },
};

const numberGenerators = {
    getNextReceiptNumber,
};

async function attachItemCostSnapshots(userId, payload) {
    if (!payload || !Array.isArray(payload.items)) return payload;
    payload.items = await snapshotItemUnitCosts(userId, payload.items);
    return payload;
}

function toUserObjectId(userId) {
    if (userId instanceof mongoose.Types.ObjectId) return userId;
    return new mongoose.Types.ObjectId(String(userId));
}

function assertReceiptRecord(doc) {
    if (!doc || !isReceiptDocument(doc)) {
        const err = new Error('Receipt not found');
        err.status = 404;
        throw err;
    }
}

async function attachClientNames(receipts, userId) {
    return attachClientNamesToDocuments(receipts, userId);
}

const RECEIPT_LIST_BASE = { status: PAID, ...RECEIPT_ONLY_FILTER };

async function mergeReceiptSearchFilter(filter, userId, search) {
    const q = String(search || '').trim();
    if (!q) return filter;

    const clientIds = await resolveSearchClientIds(userId, q);
    const textFilter = buildSearchFilter(q, ['receiptNumber', ...DOCUMENT_CLIENT_SEARCH_FIELDS]);
    const or = [...(textFilter?.$or || [])];
    if (clientIds.length > 0) {
        or.push({ clientId: { $in: clientIds } });
    }
    if (or.length > 0) {
        return { ...filter, $or: or };
    }
    return filter;
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

router.get('/next-number', auth, async (req, res) => {
    try {
        const receiptNumber = await peekNextReceiptNumber(req.user.userId);
        res.json({ receiptNumber });
    } catch (err) {
        res.status(500).json({ message: err.message || 'Could not preview receipt number' });
    }
});

router.get('/export', auth, asyncHandler(async (req, res) => {
    await sendReceiptListExport(req, res);
}));

router.get('/', auth, asyncHandler(async (req, res) => {
    const userId = req.user.userId;

    if (isSummaryOnlyRequest(req.query)) {
        const summaryOpts = await resolveListSummaryOptions(req, userId);
        const summaryCounts = await countListSummary(
            Invoice,
            { userId, ...RECEIPT_LIST_BASE },
            summaryOpts
        );
        return res.json({
            summary: buildSummaryResponse('totalReceipts', summaryCounts.total, summaryCounts),
        });
    }

    const { page, limit, skip } = parsePagination(req);
    const sortKey = String(req.query.sort || 'newest').trim();
    const sort = RECEIPT_SORT[sortKey] || RECEIPT_SORT.newest;
    const search = String(req.query.search || '').trim();
    const paymentStatus = String(req.query.status || 'all').trim().toLowerCase();
    const dateFilter = await getListPeriodMongoFilter(req.query, userId);

    let filter = { userId, ...RECEIPT_LIST_BASE };

    if (dateFilter) {
        Object.assign(filter, dateFilter);
    }

    if (paymentStatus === 'partial') {
        Object.assign(filter, buildReceiptPartialFilter());
    } else if (paymentStatus === 'full') {
        Object.assign(filter, buildReceiptFullFilter());
    }

    filter = await mergeReceiptSearchFilter(filter, userId, search);

    const includeSummary = shouldFetchListSummary(req.query);
    const summaryOpts = includeSummary ? await resolveListSummaryOptions(req, userId) : null;

    const [{ data, total }, statusCounts, summaryCounts] = await Promise.all([
        paginateFind(Invoice, filter, {
            skip,
            limit,
            sort,
            select: '-items -notes',
            lean: true,
        }),
        getReceiptPaymentStatusCounts(userId, dateFilter || {}),
        includeSummary
            ? countListSummary(Invoice, { userId, ...RECEIPT_LIST_BASE }, summaryOpts)
            : Promise.resolve(null),
    ]);

    const withClients = await attachClientNames(data, userId);
    res.json({
        data: withClients,
        pagination: buildPaginationMeta(page, limit, total),
        statusCounts,
        ...(summaryCounts
            ? { summary: buildSummaryResponse('totalReceipts', summaryCounts.total, summaryCounts) }
            : {}),
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
        const normalized = normalizeReceiptPayload(req.body, { isCreate: true });
        stripPremiumDocumentFooter(normalized, await isUserPremium(req.user.userId));
        await applyClientSnapshot(normalized, req.user.userId);
        const payload = await assignReceiptNumbers(
            normalized,
            null,
            req.user.userId,
            numberGenerators
        );
        if (payload.status === PAID) {
            const paymentAmount = resolveReceiptPaymentAmount(req.body, payload.total);
            applyReceiptPaymentLedger(payload, { amount: paymentAmount });
            attachPublicTokenIfNeeded(payload);
        }
        await attachItemCostSnapshots(req.user.userId, payload);
        await attachDocumentBaseAmounts(req.user.userId, payload, {
            amountPaid: payload.amountPaid || 0,
        });
        const receipt = await Invoice.create({
            ...payload,
            userId: req.user.userId,
        });
        const allowOverselling = await getAllowOverselling(req.user.userId);
        const stockWarnings = allowOverselling
            ? await checkStockWarnings(req.user.userId, {
                prevDoc: null,
                nextDoc: receipt,
            })
            : [];
        await applyInventoryTransition({
            userId: req.user.userId,
            prevDoc: null,
            nextDoc: receipt,
            allowOverselling,
        });
        if (payload.status === PAID) {
            await tryAutoEmailReceipt({ receipt, userId: req.user.userId });
        }
        res.status(201).json(withStockWarnings(receipt, stockWarnings));
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
        res.status(500).json({ message: err.message || 'Could not create receipt' });
    }
});

async function attachClientToReceipt(receipt, userId) {
    const doc = typeof receipt.toObject === 'function' ? receipt.toObject() : { ...receipt };
    if (!doc.clientId) {
        doc.client = doc.clientName || doc.clientCompany
            ? {
                name: doc.clientName || '',
                email: '',
                company: doc.clientCompany || '',
                phone: '',
                address: '',
            }
            : null;
        return doc;
    }
    const client = await Client.findOne({ _id: doc.clientId, userId })
        .select('name email company phone address')
        .lean();
    doc.client = client
        ? {
            _id: client._id,
            id: String(client._id),
            name: client.name || '',
            email: client.email || '',
            company: client.company || '',
            phone: client.phone || '',
            address: client.address || '',
        }
        : (doc.clientName || doc.clientCompany
            ? {
                name: doc.clientName || '',
                email: '',
                company: doc.clientCompany || '',
                phone: '',
                address: '',
            }
            : null);
    return doc;
}

router.get('/:id', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const receipt = await Invoice.findOne({
        _id: req.params.id,
        userId: req.user.userId,
        ...RECEIPT_ONLY_FILTER,
    });
    if (!receipt) return res.status(404).json({ message: 'Receipt not found' });
    res.json(await attachClientToReceipt(receipt, req.user.userId));
}));

router.put('/:id', auth, requireEmailVerified, validateObjectId(), async (req, res) => {
    let reserved = false;
    try {
        const existing = await Invoice.findOne({
            _id: req.params.id,
            userId: req.user.userId,
            ...RECEIPT_ONLY_FILTER,
        });
        if (!existing) return res.status(404).json({ message: 'Receipt not found' });

        const normalized = normalizeReceiptPayload(req.body, { existing });
        stripPremiumDocumentFooter(normalized, await isUserPremium(req.user.userId));
        await applyClientSnapshot(normalized, req.user.userId, existing);
        if (isFinalizingReceiptDraft(existing, normalized)) {
            await reserveInvoiceCreation(req.user.userId);
            reserved = true;
        }

        const payload = await assignReceiptNumbers(
            normalized,
            existing,
            req.user.userId,
            numberGenerators
        );

        if (payload.status === PAID) {
            const paymentAmount = resolveReceiptPaymentAmount(req.body, payload.total);
            applyReceiptPaymentLedger(payload, { amount: paymentAmount });
            attachPublicTokenIfNeeded(payload, existing);
        }

        await attachItemCostSnapshots(req.user.userId, payload);
        await attachDocumentBaseAmounts(req.user.userId, payload, {
            amountPaid: payload.amountPaid ?? existing.amountPaid ?? 0,
        });

        const update = Object.fromEntries(
            Object.entries(payload).filter(([, value]) => value !== undefined)
        );

        const receipt = await Invoice.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.userId, ...RECEIPT_ONLY_FILTER },
            update,
            { new: true }
        );

        if (isFinalizingReceiptDraft(existing, normalized) && receipt.status === PAID) {
            await tryAutoEmailReceipt({ receipt, userId: req.user.userId });
        }

        const allowOverselling = await getAllowOverselling(req.user.userId);
        const stockWarnings = allowOverselling
            ? await checkStockWarnings(req.user.userId, {
                prevDoc: existing,
                nextDoc: receipt,
            })
            : [];
        await applyInventoryTransition({
            userId: req.user.userId,
            prevDoc: existing,
            nextDoc: receipt,
            allowOverselling,
        });

        res.json(withStockWarnings(receipt, stockWarnings));
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
        res.status(500).json({ message: err.message || 'Could not update receipt' });
    }
});

router.post('/:id/payments', auth, requireEmailVerified, validateObjectId(), async (req, res) => {
    try {
        const receipt = await Invoice.findOne({
            _id: req.params.id,
            userId: req.user.userId,
            ...RECEIPT_ONLY_FILTER,
        });
        assertReceiptRecord(receipt);
        if (receipt.status !== PAID) {
            return res.status(400).json({ message: 'Payments can only be recorded on issued receipts.' });
        }

        applyReceiptPayment(receipt, req.body);
        await receipt.save();

        res.json(await attachClientToReceipt(receipt, req.user.userId));
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        console.error('Record receipt payment error:', err);
        res.status(500).json({ message: err.message || 'Could not record payment' });
    }
});

router.post('/:id/send-receipt', auth, requireEmailVerified, validateObjectId(), async (req, res) => {
    try {
        const receipt = await Invoice.findOne({
            _id: req.params.id,
            userId: req.user.userId,
            ...RECEIPT_ONLY_FILTER,
        });
        assertReceiptRecord(receipt);
        if (receipt.status !== PAID) {
            return res.status(400).json({ message: 'Only issued receipts can be emailed.' });
        }
        if (!receipt.receiptNumber) {
            return res.status(400).json({ message: 'This receipt does not have a receipt number.' });
        }

        const result = await dispatchReceiptEmailToClient({
            receipt,
            userId: req.user.userId,
        });

        res.json({ message: 'Receipt email sent.', sentTo: result.sentTo });
    } catch (err) {
        if (err.status === 400 || err.status === 404) {
            return res.status(err.status).json({ message: err.message });
        }
        console.error('Send receipt email error:', err);
        return res.status(503).json({ message: getEmailErrorMessage(err) });
    }
});

router.delete('/:id', auth, requireEmailVerified, validateObjectId(), async (req, res) => {
    try {
        const existing = await Invoice.findOne({
            _id: req.params.id,
            userId: req.user.userId,
            ...RECEIPT_ONLY_FILTER,
        });
        if (!existing) return res.status(404).json({ message: 'Receipt not found' });
        assertReceiptDeleteAllowed(existing);
        await Invoice.deleteOne({ _id: existing._id });
        res.json({ message: 'Receipt deleted' });
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        res.status(500).json({ message: err.message || 'Could not delete receipt' });
    }
});

export default router;
