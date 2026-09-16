import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildPayrollExpenseDescription,
    buildPayrollResponse,
    buildPayrollRow,
    buildPayrollTotals,
    duplicatePayrollError,
    formatPayrollPeriod,
    formatPayrollPeriodLabel,
    isDuplicatePayrollKeyError,
    parsePayrollPeriodInput,
    parsePayrollPeriodString,
    selectPayrollStaff,
    staffHasPayrollExpensesError,
} from '../utils/staffPayroll.js';

test('formatPayrollPeriod zero-pads the month', () => {
    assert.equal(formatPayrollPeriod(2026, 3), '2026-03');
    assert.equal(formatPayrollPeriod(2026, 11), '2026-11');
});

test('formatPayrollPeriodLabel uses the full month name', () => {
    assert.equal(formatPayrollPeriodLabel(2026, 3), 'March 2026');
});

test('parsePayrollPeriodString accepts YYYY-MM and rejects invalid values', () => {
    assert.deepEqual(parsePayrollPeriodString('2026-09'), {
        year: 2026,
        month: 9,
        period: '2026-09',
    });
    assert.equal(parsePayrollPeriodString('2026-13'), null);
    assert.equal(parsePayrollPeriodString('26-09'), null);
});

test('parsePayrollPeriodInput reads year and month or period', () => {
    assert.deepEqual(parsePayrollPeriodInput({ year: '2026', month: '4' }), {
        year: 2026,
        month: 4,
        period: '2026-04',
    });
    assert.deepEqual(parsePayrollPeriodInput({ period: '2026-04' }), {
        year: 2026,
        month: 4,
        period: '2026-04',
    });
});

test('parsePayrollPeriodInput rejects an invalid month', () => {
    assert.throws(
        () => parsePayrollPeriodInput({ year: 2026, month: 13 }),
        (err) => err.status === 400
    );
});

test('buildPayrollExpenseDescription snapshots role and month', () => {
    assert.equal(
        buildPayrollExpenseDescription('Designer', 2026, 3),
        'Designer · March 2026'
    );
    assert.equal(buildPayrollExpenseDescription('', 2026, 3), 'March 2026');
});

test('isDuplicatePayrollKeyError detects Mongo duplicate key errors', () => {
    assert.equal(isDuplicatePayrollKeyError({ code: 11000 }), true);
    assert.equal(isDuplicatePayrollKeyError({ code: 11001 }), false);
    assert.equal(isDuplicatePayrollKeyError(null), false);
});

test('duplicatePayrollError and staffHasPayrollExpensesError use 409', () => {
    const paid = duplicatePayrollError();
    assert.equal(paid.status, 409);
    assert.equal(paid.code, 'PAYROLL_ALREADY_PAID');

    const linked = staffHasPayrollExpensesError();
    assert.equal(linked.status, 409);
    assert.equal(linked.code, 'STAFF_HAS_PAYROLL');
});

test('selectPayrollStaff keeps active staff and paid inactive staff', () => {
    const payments = new Map([['inactive-paid', { amount: 80 }]]);
    const selected = selectPayrollStaff(
        [
            { _id: 'active', name: 'Ada', isActive: true },
            { _id: 'inactive-paid', name: 'Bola', isActive: false },
            { _id: 'inactive-unpaid', name: 'Chidi', isActive: false },
        ],
        payments
    );

    assert.deepEqual(
        selected.map((row) => row._id),
        ['active', 'inactive-paid']
    );
});

test('buildPayrollRow uses the expense snapshot when paid', () => {
    const unpaid = buildPayrollRow(
        { _id: '1', name: 'Ada', role: 'Driver', salary: 120.555, isActive: true },
        null
    );
    assert.equal(unpaid.paid, false);
    assert.equal(unpaid.amount, 120.56);
    assert.equal(unpaid.expenseId, null);

    const paid = buildPayrollRow(
        { id: '1', name: 'Ada', role: 'Driver', salary: 150, isActive: true },
        { _id: 'exp1', amount: 120, date: '2026-03-15' }
    );
    assert.equal(paid.paid, true);
    assert.equal(paid.amount, 120);
    assert.equal(paid.expenseId, 'exp1');
    assert.equal(paid.paidDate, '2026-03-15');
});

test('buildPayrollTotals sums due, paid, and remaining', () => {
    const totals = buildPayrollTotals([
        { amount: 100, paid: true, isActive: true },
        { amount: 50.255, paid: false, isActive: true },
        { amount: 80, paid: true, isActive: false },
    ]);

    assert.equal(totals.due, 230.26);
    assert.equal(totals.paid, 180);
    assert.equal(totals.remaining, 50.26);
    assert.equal(totals.paidCount, 2);
    assert.equal(totals.unpaidCount, 1);
    assert.equal(totals.activeCount, 2);
});

test('buildPayrollResponse lists unpaid first and ignores regular expenses', () => {
    const result = buildPayrollResponse({
        year: 2026,
        month: 3,
        staffList: [
            { _id: 's2', name: 'Zainab', role: 'Cook', salary: 80, isActive: true },
            { _id: 's1', name: 'Ada', role: 'Driver', salary: 100, isActive: true },
        ],
        payments: [
            { _id: 'e1', staffId: 's1', amount: 100, date: '2026-03-02' },
            { _id: 'e2', amount: 40 },
        ],
    });

    assert.equal(result.period.label, 'March 2026');
    assert.deepEqual(
        result.staff.map((row) => row.name),
        ['Zainab', 'Ada']
    );
    assert.equal(result.staff[0].paid, false);
    assert.equal(result.staff[1].paid, true);
    assert.equal(result.totals.due, 180);
    assert.equal(result.totals.paid, 100);
    assert.equal(result.totals.remaining, 80);
});
