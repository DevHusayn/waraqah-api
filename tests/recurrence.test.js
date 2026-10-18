import test from 'node:test';
import assert from 'node:assert/strict';
import {
    addFrequency,
    applyRecurringSchedule,
    computeRecurringDueDate,
    shouldGenerateRecurrence,
} from '../utils/recurrence.js';
import { buildRecurringInvoiceChildPayload, markSeriesRecurring } from '../utils/recurringInvoices.js';
import { buildRecurringExpenseChildPayload } from '../utils/recurringExpenses.js';
import { applyListRecurringAndDateFilter, includeRecurringChildren } from '../utils/recurringListFilter.js';

test('addFrequency clamps month-end and leap years', () => {
    assert.equal(addFrequency('2026-01-31', 'monthly'), '2026-02-28');
    assert.equal(addFrequency('2024-01-31', 'monthly'), '2024-02-29');
    assert.equal(addFrequency('2024-02-29', 'yearly'), '2025-02-28');
    assert.equal(addFrequency('2026-08-26', 'weekly'), '2026-09-02');
});

test('shouldGenerateRecurrence skips future next dates and dates after the end', () => {
    assert.equal(shouldGenerateRecurrence({ nextDate: '2026-09-02', today: '2026-09-01' }), false);
    assert.equal(
        shouldGenerateRecurrence({
            nextDate: '2026-09-01',
            endDate: '2026-08-31',
            today: '2026-09-01',
        }),
        false
    );
    assert.equal(shouldGenerateRecurrence({ nextDate: '2026-09-01', today: '2026-09-01' }), true);
});

test('applyRecurringSchedule requires a frequency and computes next date', () => {
    assert.throws(
        () => applyRecurringSchedule({ isRecurring: true, date: '2026-08-26', status: 'pending' }),
        (err) => err.message.includes('how often')
    );

    const data = applyRecurringSchedule({
        isRecurring: true,
        recurringFrequency: 'monthly',
        date: '2026-08-26',
        status: 'pending',
    });
    assert.equal(data.recurringNextDate, '2026-09-26');
});

test('applyRecurringSchedule keeps an existing next date when issue date is unchanged', () => {
    const data = applyRecurringSchedule(
        { isRecurring: true, recurringFrequency: 'monthly', notes: 'updated' },
        {
            existing: {
                isRecurring: true,
                recurringFrequency: 'monthly',
                date: '2026-08-26',
                status: 'pending',
                recurringNextDate: '2026-10-26',
            },
        }
    );
    assert.equal(data.recurringNextDate, '2026-10-26');
});

test('buildRecurringInvoiceChildPayload copies due-date offset and source id', () => {
    const child = buildRecurringInvoiceChildPayload({
        _id: 'tmpl1',
        userId: 'user1',
        clientId: 'client1',
        date: '2026-08-26',
        dueDate: '2026-09-09',
        recurringNextDate: '2026-09-26',
        items: [{ description: 'Retainer', quantity: 1, rate: 50000, unit: 'Qty' }],
        notes: 'Thanks',
        currency: 'NGN',
        taxRate: 0,
        subtotal: 50000,
        tax: 0,
        total: 50000,
    });

    assert.equal(child.isRecurring, false);
    assert.equal(child.status, 'pending');
    assert.equal(child.date, '2026-09-26');
    assert.equal(child.dueDate, '2026-10-10');
    assert.equal(child.recurringSourceId, 'tmpl1');
    assert.equal(computeRecurringDueDate('2026-08-26', '2026-09-09', '2026-09-26'), '2026-10-10');
});

test('buildRecurringExpenseChildPayload copies amount and source id', () => {
    const child = buildRecurringExpenseChildPayload({
        _id: 'exp1',
        userId: 'user1',
        date: '2026-08-01',
        recurringNextDate: '2026-09-01',
        amount: 120000,
        category: 'rent',
        description: 'Office',
        vendor: 'Landlord',
    });

    assert.equal(child.isRecurring, false);
    assert.equal(child.date, '2026-09-01');
    assert.equal(child.amount, 120000);
    assert.equal(child.recurringSourceId, 'exp1');
    assert.equal(child.category, 'rent');
});

test('recurring list filter keeps templates even when a period date filter is present', () => {
    const dateFilter = { date: { $gte: '2026-09-01', $lt: '2026-10-01' } };

    const recurring = applyListRecurringAndDateFilter(
        { userId: 'u1' },
        { recurring: '1', dateFilter }
    );
    assert.deepEqual(recurring, { userId: 'u1', isRecurring: true });

    const monthly = applyListRecurringAndDateFilter(
        { userId: 'u1' },
        { recurring: undefined, dateFilter }
    );
    assert.deepEqual(monthly, { userId: 'u1', date: dateFilter.date });
});

test('generated invoices stay marked recurring while their template is active', () => {
    const rows = markSeriesRecurring(
        [
            { _id: 'child', isRecurring: false, recurringSourceId: 'tmpl' },
            { _id: 'stopped-child', isRecurring: false, recurringSourceId: 'old' },
            { _id: 'tmpl', isRecurring: true },
        ],
        ['tmpl']
    );
    assert.equal(rows[0].seriesRecurring, true);
    assert.equal(rows[1].seriesRecurring, false);
    assert.equal(rows[2].seriesRecurring, true);
});

test('recurring list filter includes children of active templates', () => {
    const filter = applyListRecurringAndDateFilter({ userId: 'u1' }, { recurring: '1' });
    includeRecurringChildren(filter, ['tmpl']);
    assert.equal(filter.isRecurring, undefined);
    assert.deepEqual(filter.$or, [
        { isRecurring: true },
        { recurringSourceId: { $in: ['tmpl'] } },
    ]);
});
