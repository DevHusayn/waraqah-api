import express from 'express';
import Expense from '../models/Expense.js';
import Staff from '../models/Staff.js';
import auth from '../middleware/auth.js';
import validateObjectId from '../middleware/validateObjectId.js';
import asyncHandler from '../middleware/asyncHandler.js';
import {
    sanitizeExpensePayload,
    sanitizeExpenseUpdates,
    sanitizePlainText,
} from '../utils/sanitize.js';
import { stoppedRecurringFields } from '../utils/recurrence.js';
import {
    parsePagination,
    paginateFind,
    buildPaginationMeta,
    buildSearchFilter,
    escapeRegex,
} from '../utils/pagination.js';
import { getListPeriodMongoFilter } from '../utils/listMonthFilter.js';
import { getBusinessTimezone, resolveAnalyticsPeriod } from '../utils/timezone.js';
import { getExpenseSummaryForUser } from '../utils/expenseAnalytics.js';
import { applyListRecurringAndDateFilter } from '../utils/recurringListFilter.js';
import { EXPENSE_LIST_SORT, resolveListSort } from '../utils/listSort.js';
import { uniqueVendorNames } from '../utils/expenseVendors.js';
import { buildPayeeDetail, buildPayeeList } from '../utils/expensePayees.js';

const router = express.Router();

async function buildExpenseListFilter(req) {
    const userId = req.user.userId;
    const filter = { userId };
    const searchFilter = buildSearchFilter(req.query.search, ['description', 'vendor']);
    if (searchFilter) Object.assign(filter, searchFilter);

    const dateFilter = await getListPeriodMongoFilter(req.query, userId);
    applyListRecurringAndDateFilter(filter, {
        recurring: req.query.recurring,
        dateFilter,
    });
    const category = sanitizePlainText(req.query.category, 50);
    if (category) {
        filter.category = category;
    }
    return filter;
}

function vendorNameFilter(name) {
    const vendor = sanitizePlainText(name, 200);
    if (!vendor) return null;
    return {
        vendor: { $regex: `^${escapeRegex(vendor)}$`, $options: 'i' },
    };
}

router.get('/summary', auth, asyncHandler(async (req, res) => {
    const timeZone = await getBusinessTimezone(req.user.userId);
    const period = resolveAnalyticsPeriod(req.query, timeZone);
    const summary = await getExpenseSummaryForUser(req.user.userId, { period, timeZone });
    res.json(summary);
}));

router.get('/vendors', auth, asyncHandler(async (req, res) => {
    const names = await Expense.distinct('vendor', {
        userId: req.user.userId,
        vendor: { $nin: [null, ''] },
    });
    res.json(uniqueVendorNames(names));
}));

router.get('/payees', auth, asyncHandler(async (req, res) => {
    const { page, limit } = parsePagination(req);
    const filter = await buildExpenseListFilter(req);
    const expenses = await Expense.find(filter).lean();
    const sort = String(req.query.sort || 'newest');
    const { data, total } = buildPayeeList(expenses, { sort, page, limit });

    res.json({
        data,
        pagination: buildPaginationMeta(page, limit, total),
    });
}));

router.get('/payees/:name', auth, asyncHandler(async (req, res) => {
    const vendorFilter = vendorNameFilter(req.params.name);
    if (!vendorFilter) {
        return res.status(400).json({ message: 'Please enter a payee name.' });
    }

    const userId = req.user.userId;
    const expenses = await Expense.find({
        userId,
        ...vendorFilter,
    })
        .sort({ date: -1, createdAt: -1 })
        .lean();

    if (expenses.length === 0) {
        return res.status(404).json({ message: 'No expenses found for this name.' });
    }

    const staff = await Staff.findOne({
        userId,
        name: vendorFilter.vendor,
    }).lean();

    res.json({
        payee: buildPayeeDetail(req.params.name, expenses),
        staff: staff
            ? {
                id: String(staff._id),
                name: staff.name,
                role: staff.role,
                salary: staff.salary,
                isActive: staff.isActive !== false,
            }
            : null,
        expenses,
    });
}));

router.get('/', auth, asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req);
    const filter = await buildExpenseListFilter(req);

    const { data, total } = await paginateFind(Expense, filter, {
        skip,
        limit,
        ...resolveListSort(req.query.sort, EXPENSE_LIST_SORT),
        lean: true,
    });

    res.json({
        data,
        pagination: buildPaginationMeta(page, limit, total),
    });
}));

router.post('/', auth, asyncHandler(async (req, res) => {
    const payload = sanitizeExpensePayload(req.body);
    const expense = await Expense.create({ ...payload, userId: req.user.userId });
    res.status(201).json(expense);
}));

router.get('/:id', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const expense = await Expense.findOne({
        _id: req.params.id,
        userId: req.user.userId,
    }).lean();
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    res.json(expense);
}));

router.put('/:id', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const existing = await Expense.findOne({
        _id: req.params.id,
        userId: req.user.userId,
    });
    if (!existing) return res.status(404).json({ message: 'Expense not found' });

    const updates = sanitizeExpenseUpdates(req.body, existing);
    const expense = await Expense.findOneAndUpdate(
        { _id: req.params.id, userId: req.user.userId },
        updates,
        { new: true }
    );
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    res.json(expense);
}));

router.post('/:id/stop-recurring', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const expense = await Expense.findOne({
        _id: req.params.id,
        userId: req.user.userId,
    });
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    if (!expense.isRecurring) {
        return res.status(400).json({ message: 'This expense is not set to repeat.' });
    }

    expense.set(stoppedRecurringFields());
    expense.recurringFrequency = undefined;
    await expense.save();
    res.json(expense);
}));

router.delete('/:id', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const expense = await Expense.findOneAndDelete({
        _id: req.params.id,
        userId: req.user.userId,
    });
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    res.json({ message: 'Expense deleted' });
}));

export default router;
