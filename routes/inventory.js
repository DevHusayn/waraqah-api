import express from 'express';
import auth from '../middleware/auth.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { parsePagination } from '../utils/pagination.js';
import { getListPeriodMongoFilter } from '../utils/listMonthFilter.js';
import {
    getInventorySummary,
    listInventoryStock,
    listInventoryMovements,
} from '../utils/inventoryList.js';
import { getTopSellingProductsForUser } from '../utils/salesRankings.js';
import { getBusinessTimezone, resolveAnalyticsPeriod } from '../utils/timezone.js';

const router = express.Router();

router.get('/summary', auth, asyncHandler(async (req, res) => {
    const summary = await getInventorySummary(req.user.userId);
    res.json(summary);
}));

router.get('/top-products', auth, asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const timeZone = await getBusinessTimezone(userId);
    const period = resolveAnalyticsPeriod(req.query, timeZone);
    const result = await getTopSellingProductsForUser(userId, { period, timeZone });
    res.json(result);
}));

router.get('/stock', auth, asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req);
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || 'all').trim().toLowerCase();

    const result = await listInventoryStock(req.user.userId, {
        page,
        limit,
        skip,
        search,
        status,
    });

    res.json(result);
}));

router.get('/movements', auth, asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req);
    const search = String(req.query.search || '').trim();
    const dateFilter = await getListPeriodMongoFilter(req.query, req.user.userId, {
        dateField: 'createdAt',
    });

    const result = await listInventoryMovements(req.user.userId, {
        page,
        limit,
        skip,
        search,
        dateFilter,
    });

    res.json(result);
}));

export default router;
