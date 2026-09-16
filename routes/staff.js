import express from 'express';
import Staff from '../models/Staff.js';
import Expense from '../models/Expense.js';
import auth from '../middleware/auth.js';
import validateObjectId from '../middleware/validateObjectId.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { sanitizeStaffPayload, sanitizeStaffUpdates } from '../utils/sanitize.js';
import {
    buildPayrollExpenseDescription,
    buildPayrollResponse,
    duplicatePayrollError,
    isDuplicatePayrollKeyError,
    parsePayrollPeriodInput,
    staffHasPayrollExpensesError,
} from '../utils/staffPayroll.js';
import {
    getBusinessTimezone,
    getDatePartsInTimezone,
    toDateInputValue,
} from '../utils/timezone.js';

const router = express.Router();

async function todayInBusinessTimezone(userId) {
    const timeZone = await getBusinessTimezone(userId);
    const parts = getDatePartsInTimezone(timeZone);
    return toDateInputValue(parts.year, parts.month, parts.day);
}

router.get('/payroll', auth, asyncHandler(async (req, res) => {
    const { year, month, period } = parsePayrollPeriodInput(req.query);
    const userId = req.user.userId;
    const [staffList, payments] = await Promise.all([
        Staff.find({ userId }).lean(),
        Expense.find({
            userId,
            payrollPeriod: period,
            staffId: { $ne: null },
        }).lean(),
    ]);

    res.json(buildPayrollResponse({ year, month, staffList, payments }));
}));

router.get('/', auth, asyncHandler(async (req, res) => {
    const staff = await Staff.find({ userId: req.user.userId })
        .sort({ isActive: -1, name: 1 })
        .lean();
    res.json({ data: staff });
}));

router.post('/', auth, asyncHandler(async (req, res) => {
    const payload = sanitizeStaffPayload(req.body);
    const staff = await Staff.create({ ...payload, userId: req.user.userId });
    res.status(201).json(staff);
}));

router.get('/:id', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const staff = await Staff.findOne({
        _id: req.params.id,
        userId: req.user.userId,
    }).lean();
    if (!staff) return res.status(404).json({ message: 'Staff not found' });
    res.json(staff);
}));

router.put('/:id', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const updates = sanitizeStaffUpdates(req.body);
    const staff = await Staff.findOneAndUpdate(
        { _id: req.params.id, userId: req.user.userId },
        updates,
        { new: true }
    );
    if (!staff) return res.status(404).json({ message: 'Staff not found' });
    res.json(staff);
}));

router.delete('/:id', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const staff = await Staff.findOne({
        _id: req.params.id,
        userId: req.user.userId,
    });
    if (!staff) return res.status(404).json({ message: 'Staff not found' });

    const linked = await Expense.exists({
        userId: req.user.userId,
        staffId: staff._id,
    });
    if (linked) {
        const err = staffHasPayrollExpensesError();
        return res.status(err.status).json({ message: err.message, code: err.code });
    }

    await staff.deleteOne();
    res.json({ message: 'Staff deleted' });
}));

router.post('/:id/pay', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const { year, month, period } = parsePayrollPeriodInput(req.body);
    const userId = req.user.userId;
    const staff = await Staff.findOne({
        _id: req.params.id,
        userId,
    });
    if (!staff) return res.status(404).json({ message: 'Staff not found' });
    if (!staff.isActive) {
        return res.status(400).json({
            message: 'This staff member is inactive. Reactivate them to mark a new payment.',
        });
    }

    const alreadyPaid = await Expense.exists({
        userId,
        staffId: staff._id,
        payrollPeriod: period,
    });
    if (alreadyPaid) {
        const err = duplicatePayrollError();
        return res.status(err.status).json({ message: err.message, code: err.code });
    }

    try {
        const expense = await Expense.create({
            userId,
            date: await todayInBusinessTimezone(userId),
            amount: staff.salary,
            category: 'salaries',
            vendor: staff.name,
            description: buildPayrollExpenseDescription(staff.role, year, month),
            staffId: staff._id,
            payrollPeriod: period,
        });
        res.status(201).json(expense);
    } catch (err) {
        if (isDuplicatePayrollKeyError(err)) {
            const conflict = duplicatePayrollError();
            return res.status(conflict.status).json({ message: conflict.message, code: conflict.code });
        }
        throw err;
    }
}));

router.post('/:id/unpay', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const { period } = parsePayrollPeriodInput(req.body);
    const expense = await Expense.findOneAndDelete({
        userId: req.user.userId,
        staffId: req.params.id,
        payrollPeriod: period,
    });
    if (!expense) {
        return res.status(404).json({ message: 'No salary payment found for that month.' });
    }
    res.json({ message: 'Payment removed', id: expense._id });
}));

export default router;
