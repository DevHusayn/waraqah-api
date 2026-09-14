import express from 'express';
import Client from '../models/Client.js';
import auth from '../middleware/auth.js';
import validateObjectId from '../middleware/validateObjectId.js';
import { sanitizeClientPayload, sanitizeClientUpdates } from '../utils/sanitize.js';
import asyncHandler from '../middleware/asyncHandler.js';
import {
    parsePagination,
    paginateFind,
    buildPaginationMeta,
    buildSearchFilter,
} from '../utils/pagination.js';
import { countListSummary, buildSummaryResponse, resolveListSummaryOptions, isSummaryOnlyRequest, shouldFetchListSummary } from '../utils/listSummary.js';
import { getListPeriodMongoFilter } from '../utils/listMonthFilter.js';
import { sendClientListExport } from '../utils/clientListExport.js';
import { getClientActivity } from '../utils/clientActivity.js';
import { CATALOG_LIST_SORT, resolveListSort } from '../utils/listSort.js';
import { getTopBuyingClientsForUser } from '../utils/salesRankings.js';
import { getBusinessTimezone, resolveAnalyticsPeriod } from '../utils/timezone.js';

const router = express.Router();

router.get('/export', auth, asyncHandler(async (req, res) => {
    await sendClientListExport(req, res);
}));

router.get('/', auth, asyncHandler(async (req, res) => {
    const userId = req.user.userId;

    if (isSummaryOnlyRequest(req.query)) {
        const summaryOpts = await resolveListSummaryOptions(req, userId);
        const summaryCounts = await countListSummary(Client, { userId }, summaryOpts);
        return res.json({
            summary: buildSummaryResponse('totalClients', summaryCounts.total, summaryCounts),
        });
    }

    const { page, limit, skip } = parsePagination(req);
    const filter = { userId };
    const searchFilter = buildSearchFilter(req.query.search, [
        'name',
        'email',
        'company',
        'phone',
    ]);
    if (searchFilter) Object.assign(filter, searchFilter);

    const dateFilter = await getListPeriodMongoFilter(req.query, userId, { dateField: 'createdAt' });
    if (dateFilter) Object.assign(filter, dateFilter);

    const includeSummary = shouldFetchListSummary(req.query);
    const summaryOpts = includeSummary ? await resolveListSummaryOptions(req, userId) : null;

    const [{ data, total }, summaryCounts] = await Promise.all([
        paginateFind(Client, filter, {
            skip,
            limit,
            ...resolveListSort(req.query.sort, CATALOG_LIST_SORT),
            lean: true,
        }),
        includeSummary
            ? countListSummary(Client, { userId }, summaryOpts)
            : Promise.resolve(null),
    ]);

    res.json({
        data,
        pagination: buildPaginationMeta(page, limit, total),
        ...(summaryCounts
            ? { summary: buildSummaryResponse('totalClients', summaryCounts.total, summaryCounts) }
            : {}),
    });
}));

router.post('/', auth, asyncHandler(async (req, res) => {
    const payload = sanitizeClientPayload(req.body);
    const client = await Client.create({ ...payload, userId: req.user.userId });
    res.status(201).json(client);
}));

router.get('/top-buyers', auth, asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const timeZone = await getBusinessTimezone(userId);
    const period = resolveAnalyticsPeriod(req.query, timeZone);
    const result = await getTopBuyingClientsForUser(userId, { period, timeZone });
    res.json(result);
}));

router.get('/:id/activity', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const activity = await getClientActivity(req.user.userId, req.params.id);
    if (!activity) return res.status(404).json({ message: 'Client not found' });
    res.json(activity);
}));

router.get('/:id', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const client = await Client.findOne({
        _id: req.params.id,
        userId: req.user.userId,
    }).lean();
    if (!client) return res.status(404).json({ message: 'Client not found' });
    res.json(client);
}));

router.put('/:id', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const updates = sanitizeClientUpdates(req.body);
    const client = await Client.findOneAndUpdate(
        { _id: req.params.id, userId: req.user.userId },
        updates,
        { new: true }
    );
    if (!client) return res.status(404).json({ message: 'Client not found' });
    res.json(client);
}));

router.delete('/:id', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const client = await Client.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
    if (!client) return res.status(404).json({ message: 'Client not found' });
    res.json({ message: 'Client deleted' });
}));

export default router;
