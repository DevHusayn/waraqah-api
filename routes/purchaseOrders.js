import express from 'express';
import mongoose from 'mongoose';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Supplier from '../models/Supplier.js';
import auth from '../middleware/auth.js';
import validateObjectId from '../middleware/validateObjectId.js';
import asyncHandler from '../middleware/asyncHandler.js';
import {
    parsePagination,
    paginateFind,
    buildPaginationMeta,
    buildSearchFilter,
    escapeRegex,
} from '../utils/pagination.js';
import {
    countListSummary,
    buildSummaryResponse,
    resolveListSummaryOptions,
    isSummaryOnlyRequest,
    shouldFetchListSummary,
} from '../utils/listSummary.js';
import { getListPeriodMongoFilter } from '../utils/listMonthFilter.js';
import { getNextPurchaseOrderNumber } from '../utils/purchaseOrderNumber.js';
import {
    PO_DRAFT,
    PO_SENT,
    assertPurchaseOrderDeleteAllowed,
    assignPurchaseOrderNumber,
    normalizePurchaseOrderPayload,
    sanitizeReceivePayload,
} from '../utils/purchaseOrderValidation.js';
import { receivePurchaseOrderLines } from '../utils/purchaseOrderReceive.js';
import { attachDocumentBaseAmounts } from '../utils/documentCurrency.js';

const router = express.Router();

const PO_SORT = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    expectedDate: { expectedDate: 1 },
    amountHigh: { total: -1 },
    amountLow: { total: 1 },
};

async function attachSupplierNames(orders, userId) {
    const supplierIds = [
        ...new Set(
            orders
                .map((order) => order.supplierId)
                .filter(Boolean)
                .map((id) => String(id))
        ),
    ];
    if (supplierIds.length === 0) {
        return orders.map((order) => ({ ...order, supplierName: null }));
    }
    const suppliers = await Supplier.find({
        userId,
        _id: { $in: supplierIds },
    })
        .select('name company')
        .lean();
    const byId = new Map(suppliers.map((entry) => [String(entry._id), entry]));
    return orders.map((order) => {
        const supplier = order.supplierId ? byId.get(String(order.supplierId)) : null;
        return {
            ...order,
            supplierName: supplier?.name || null,
            supplierCompany: supplier?.company || null,
        };
    });
}

async function resolveSearchSupplierIds(userId, search) {
    const q = String(search || '').trim();
    if (!q) return [];
    const regex = new RegExp(escapeRegex(q), 'i');
    const suppliers = await Supplier.find({
        userId,
        $or: [{ name: regex }, { company: regex }, { email: regex }],
    })
        .select('_id')
        .lean();
    return suppliers.map((entry) => entry._id);
}

async function getPurchaseOrderStatusCounts(userId, extraMatch = {}) {
    const uid =
        userId instanceof mongoose.Types.ObjectId
            ? userId
            : new mongoose.Types.ObjectId(String(userId));
    const rows = await PurchaseOrder.aggregate([
        { $match: { userId: uid, status: { $ne: PO_DRAFT }, ...extraMatch } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const statusCounts = {
        all: 0,
        sent: 0,
        partial: 0,
        received: 0,
        cancelled: 0,
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

router.get('/next-number', auth, asyncHandler(async (req, res) => {
    const purchaseOrderNumber = await getNextPurchaseOrderNumber(req.user.userId);
    res.json({ purchaseOrderNumber });
}));

router.get('/', auth, asyncHandler(async (req, res) => {
    const userId = req.user.userId;

    if (isSummaryOnlyRequest(req.query)) {
        const listBase = { userId, status: { $ne: PO_DRAFT } };
        const summaryOpts = await resolveListSummaryOptions(req, userId);
        const summaryCounts = await countListSummary(PurchaseOrder, listBase, summaryOpts);
        return res.json({
            summary: buildSummaryResponse('totalPurchaseOrders', summaryCounts.total, summaryCounts),
        });
    }

    const { page, limit, skip } = parsePagination(req);
    const status = String(req.query.status || 'all').trim().toLowerCase();
    const sortKey = String(req.query.sort || 'newest').trim();
    const sort = PO_SORT[sortKey] || PO_SORT.newest;
    const search = String(req.query.search || '').trim();
    const dateFilter = await getListPeriodMongoFilter(req.query, userId);

    const filter = { userId, status: { $ne: PO_DRAFT } };
    if (status && status !== 'all') {
        filter.status = status;
    }
    if (dateFilter) {
        Object.assign(filter, dateFilter);
    }
    if (search) {
        const supplierIds = await resolveSearchSupplierIds(userId, search);
        const textFilter = buildSearchFilter(search, ['purchaseOrderNumber']);
        const or = [...(textFilter?.$or || [])];
        if (supplierIds.length > 0) {
            or.push({ supplierId: { $in: supplierIds } });
        }
        if (or.length > 0) {
            filter.$or = or;
        }
    }

    const listBase = { userId, status: { $ne: PO_DRAFT } };
    const includeSummary = shouldFetchListSummary(req.query);
    const summaryOpts = includeSummary ? await resolveListSummaryOptions(req, userId) : null;

    const [{ data, total }, statusCounts, summaryCounts] = await Promise.all([
        paginateFind(PurchaseOrder, filter, {
            skip,
            limit,
            sort,
            select: '-items -notes',
            lean: true,
        }),
        getPurchaseOrderStatusCounts(userId, dateFilter || {}),
        includeSummary
            ? countListSummary(PurchaseOrder, listBase, summaryOpts)
            : Promise.resolve(null),
    ]);

    const withSuppliers = await attachSupplierNames(data, userId);
    res.json({
        data: withSuppliers,
        pagination: buildPaginationMeta(page, limit, total),
        statusCounts,
        ...(summaryCounts
            ? {
                  summary: buildSummaryResponse(
                      'totalPurchaseOrders',
                      summaryCounts.total,
                      summaryCounts
                  ),
              }
            : {}),
    });
}));

router.get('/drafts', auth, asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const { page, limit, skip } = parsePagination(req);
    const search = String(req.query.search || '').trim();

    const filter = { userId, status: PO_DRAFT };
    if (search) {
        const supplierIds = await resolveSearchSupplierIds(userId, search);
        const textFilter = buildSearchFilter(search, ['purchaseOrderNumber']);
        const or = [...(textFilter?.$or || [])];
        if (supplierIds.length > 0) {
            or.push({ supplierId: { $in: supplierIds } });
        }
        if (or.length > 0) {
            filter.$or = or;
        }
    }

    const { data, total } = await paginateFind(PurchaseOrder, filter, {
        skip,
        limit,
        sort: { updatedAt: -1 },
        select: '-items -notes',
        lean: true,
    });

    const withSuppliers = await attachSupplierNames(data, userId);
    res.json({
        data: withSuppliers,
        pagination: buildPaginationMeta(page, limit, total),
    });
}));

router.post('/', auth, asyncHandler(async (req, res) => {
    try {
        const normalized = normalizePurchaseOrderPayload(req.body, { isCreate: true });
        const payload = await assignPurchaseOrderNumber(normalized, null, req.user.userId);
        await attachDocumentBaseAmounts(req.user.userId, payload);
        const purchaseOrder = await PurchaseOrder.create({
            ...payload,
            userId: req.user.userId,
        });
        res.status(201).json(purchaseOrder);
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        throw err;
    }
}));

router.get('/:id', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const purchaseOrder = await PurchaseOrder.findOne({
        _id: req.params.id,
        userId: req.user.userId,
    }).lean();
    if (!purchaseOrder) {
        return res.status(404).json({ message: 'Purchase order not found' });
    }
    const [withSupplier] = await attachSupplierNames([purchaseOrder], req.user.userId);
    res.json(withSupplier);
}));

router.put('/:id', auth, validateObjectId(), asyncHandler(async (req, res) => {
    try {
        const existing = await PurchaseOrder.findOne({
            _id: req.params.id,
            userId: req.user.userId,
        });
        if (!existing) {
            return res.status(404).json({ message: 'Purchase order not found' });
        }

        const normalized = normalizePurchaseOrderPayload(req.body, { existing });
        const payload = await assignPurchaseOrderNumber(normalized, existing, req.user.userId);
        await attachDocumentBaseAmounts(req.user.userId, payload);

        existing.set(payload);
        await existing.save();
        const plain = existing.toObject();
        const [withSupplier] = await attachSupplierNames([plain], req.user.userId);
        res.json(withSupplier);
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        throw err;
    }
}));

router.post('/:id/receive', auth, validateObjectId(), asyncHandler(async (req, res) => {
    try {
        const purchaseOrder = await PurchaseOrder.findOne({
            _id: req.params.id,
            userId: req.user.userId,
        });
        if (!purchaseOrder) {
            return res.status(404).json({ message: 'Purchase order not found' });
        }

        const receiveLines = sanitizeReceivePayload(req.body);
        const { purchaseOrder: updated, sellingPricePrompts } = await receivePurchaseOrderLines(
            req.user.userId,
            purchaseOrder,
            receiveLines
        );
        const plain = updated.toObject();
        const [withSupplier] = await attachSupplierNames([plain], req.user.userId);
        res.json({ ...withSupplier, sellingPricePrompts });
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        throw err;
    }
}));

router.delete('/:id', auth, validateObjectId(), asyncHandler(async (req, res) => {
    try {
        const existing = await PurchaseOrder.findOne({
            _id: req.params.id,
            userId: req.user.userId,
        });
        if (!existing) {
            return res.status(404).json({ message: 'Purchase order not found' });
        }
        assertPurchaseOrderDeleteAllowed(existing);
        await existing.deleteOne();
        res.json({ message: 'Purchase order deleted' });
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        throw err;
    }
}));

export default router;
