import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildRevenueTrendBuckets,
    buildRevenueTrendFromDocs,
    buildPaymentBreakdown,
    buildPeriodSummaryComparison,
    computeCountPercentChange,
    computeMoneyPercentChange,
    computePeriodPaymentBreakdownFromDocs,
    computePeriodSummaryFromDocs,
    computePercentChange,
    formatTrendMonthLabel,
    shiftSummaryPeriod,
    buildPeriodSummaryFromDocs,
} from '../utils/dashboardAnalytics.js';

test('shiftSummaryPeriod moves across year boundary', () => {
    assert.deepEqual(shiftSummaryPeriod(2026, 1, -1), { year: 2025, month: 12 });
    assert.deepEqual(shiftSummaryPeriod(2026, 12, 1), { year: 2027, month: 1 });
});

test('formatTrendMonthLabel renders short month label', () => {
    assert.match(formatTrendMonthLabel(2026, 3), /Mar 2026/);
});

test('buildRevenueTrendBuckets returns oldest-first zero-filled months', () => {
    const buckets = buildRevenueTrendBuckets({
        months: 3,
        timeZone: 'UTC',
        now: new Date('2026-03-15T12:00:00.000Z'),
    });

    assert.equal(buckets.length, 3);
    assert.deepEqual(
        buckets.map(({ year, month }) => ({ year, month })),
        [
            { year: 2026, month: 1 },
            { year: 2026, month: 2 },
            { year: 2026, month: 3 },
        ]
    );
    assert.equal(buckets.every((bucket) => bucket.paid === 0 && bucket.outstanding === 0), true);
});

test('buildRevenueTrendFromDocs buckets paid revenue by invoice issue date in timezone', () => {
    const docs = [
        {
            date: '2026-01-10T00:00:00.000Z',
            status: 'paid',
            total: 1000,
            amountPaid: 1000,
            documentType: 'invoice',
        },
        {
            date: '2026-02-05T00:00:00.000Z',
            status: 'partial',
            total: 5000,
            amountPaid: 2000,
            documentType: 'invoice',
        },
        {
            date: '2026-02-20T00:00:00.000Z',
            status: 'pending',
            total: 3000,
            amountPaid: 0,
            documentType: 'invoice',
        },
        {
            date: '2026-01-25T00:00:00.000Z',
            status: 'paid',
            total: 900,
            amountPaid: 900,
            documentType: 'invoice',
        },
    ];

    const buckets = buildRevenueTrendFromDocs(docs, {
        months: 3,
        timeZone: 'UTC',
        now: new Date('2026-02-28T12:00:00.000Z'),
    });

    const jan = buckets.find((bucket) => bucket.year === 2026 && bucket.month === 1);
    const feb = buckets.find((bucket) => bucket.year === 2026 && bucket.month === 2);

    assert.equal(jan.paid, 1900);
    assert.equal(jan.outstanding, 0);
    assert.equal(feb.paid, 2000);
    assert.equal(feb.outstanding, 6000);
});

test('buildRevenueTrendFromDocs excludes cancelled and draft documents from revenue', () => {
    const docs = [
        {
            date: '2026-02-01T00:00:00.000Z',
            status: 'cancelled',
            total: 4000,
            amountPaid: 0,
            documentType: 'invoice',
        },
        {
            date: '2026-02-02T00:00:00.000Z',
            status: 'draft',
            total: 2500,
            amountPaid: 0,
            documentType: 'invoice',
        },
    ];

    const buckets = buildRevenueTrendFromDocs(docs, {
        months: 1,
        timeZone: 'UTC',
        now: new Date('2026-02-28T12:00:00.000Z'),
    });

    assert.equal(buckets[0].paid, 0);
    assert.equal(buckets[0].outstanding, 0);
});

test('buildRevenueTrendFromDocs ignores documents outside the trend window', () => {
    const docs = [
        {
            date: '2025-10-01T00:00:00.000Z',
            status: 'paid',
            total: 1200,
            amountPaid: 1200,
            documentType: 'invoice',
        },
    ];

    const buckets = buildRevenueTrendFromDocs(docs, {
        months: 3,
        timeZone: 'UTC',
        now: new Date('2026-02-28T12:00:00.000Z'),
    });

    assert.equal(buckets.every((bucket) => bucket.paid === 0), true);
});

test('buildPaymentBreakdown combines invoice statuses and receipts', () => {
    const breakdown = buildPaymentBreakdown(
        {
            paid: 15,
            partial: 5,
            pending: 0,
            overdue: 0,
            cancelled: 2,
            all: 22,
        },
        { full: 12, partial: 5, all: 17 }
    );

    assert.deepEqual(breakdown, {
        paidInvoices: 15,
        receiptsIssued: 12,
        partial: 10,
        pending: 0,
        overdue: 0,
        total: 37,
    });
});

test('computePeriodSummaryFromDocs aggregates revenue and payment counts by issue month', () => {
    const docs = [
        {
            date: '2026-02-01T00:00:00.000Z',
            status: 'paid',
            total: 1000,
            amountPaid: 1000,
            documentType: 'invoice',
        },
        {
            date: '2026-02-10T00:00:00.000Z',
            status: 'partial',
            total: 5000,
            amountPaid: 2000,
            documentType: 'invoice',
        },
        {
            date: '2026-02-12T00:00:00.000Z',
            status: 'paid',
            total: 800,
            amountPaid: 800,
            documentType: 'receipt',
        },
        {
            date: '2026-01-15T00:00:00.000Z',
            status: 'paid',
            total: 400,
            amountPaid: 400,
            documentType: 'invoice',
        },
    ];

    const summary = computePeriodSummaryFromDocs(docs, 2026, 2, 'UTC');

    assert.deepEqual(summary, {
        totalRevenue: 3800,
        outstanding: 3000,
        paidInvoices: 1,
        receiptsIssued: 1,
        paymentsReceived: 2,
    });
});

test('buildPeriodSummaryComparison calculates month-over-month deltas', () => {
    const comparison = buildPeriodSummaryComparison(
        {
            totalRevenue: 705000,
            outstanding: 128000,
            paidInvoices: 62,
            receiptsIssued: 17,
            paymentsReceived: 79,
        },
        {
            totalRevenue: 612000,
            outstanding: 136000,
            paidInvoices: 58,
            receiptsIssued: 14,
            paymentsReceived: 72,
        }
    );

    assert.deepEqual(comparison.totalRevenue, { kind: 'percent', value: 15, direction: 'up' });
    assert.deepEqual(comparison.outstanding, { kind: 'percent', value: 6, direction: 'down' });
    assert.deepEqual(comparison.paymentsReceived, { kind: 'percent', value: 10, direction: 'up' });
});

test('computePeriodPaymentBreakdownFromDocs counts statuses for the selected issue month', () => {
    const docs = [
        {
            date: '2026-08-01T00:00:00.000Z',
            status: 'paid',
            documentType: 'invoice',
        },
        {
            date: '2026-08-05T00:00:00.000Z',
            status: 'paid',
            total: 1000,
            amountPaid: 1000,
            documentType: 'receipt',
        },
        {
            date: '2026-08-06T00:00:00.000Z',
            status: 'paid',
            total: 1000,
            amountPaid: 400,
            documentType: 'receipt',
        },
        {
            date: '2026-08-08T00:00:00.000Z',
            status: 'partial',
            documentType: 'invoice',
        },
        {
            date: '2026-07-01T00:00:00.000Z',
            status: 'paid',
            documentType: 'invoice',
        },
    ];

    const breakdown = computePeriodPaymentBreakdownFromDocs(docs, 2026, 8, 'UTC');

    assert.deepEqual(breakdown, {
        fullyReceived: 2,
        partiallyReceived: 2,
        partialInvoices: 1,
        partialReceipts: 1,
        pending: 0,
        overdue: 0,
        fullyPaidInvoices: 1,
        fullyPaidReceipts: 1,
        issuedInPeriod: 4,
        total: 4,
    });
});

test('computePeriodPaymentBreakdownFromDocs counts overdue by due date in period, not issue date', () => {
    const docs = [
        {
            date: '2026-07-15T00:00:00.000Z',
            dueDate: '2026-08-22',
            status: 'overdue',
            documentType: 'invoice',
        },
        {
            date: '2026-07-20T00:00:00.000Z',
            dueDate: '2026-09-05',
            status: 'overdue',
            documentType: 'invoice',
        },
        {
            date: '2026-08-10T00:00:00.000Z',
            dueDate: '2026-08-25',
            status: 'pending',
            documentType: 'invoice',
        },
        {
            date: '2026-08-12T00:00:00.000Z',
            dueDate: '2026-09-10',
            status: 'pending',
            documentType: 'invoice',
        },
    ];

    const breakdown = computePeriodPaymentBreakdownFromDocs(
        docs,
        2026,
        8,
        'UTC',
        new Date('2026-08-26T12:00:00.000Z')
    );

    assert.equal(breakdown.overdue, 2);
    assert.equal(breakdown.pending, 1);
    assert.equal(breakdown.issuedInPeriod, 1);
});

test('computePeriodSummaryFromDocs counts only fully paid docs in paymentsReceived', () => {
    const docs = [
        {
            date: '2026-02-12T00:00:00.000Z',
            status: 'paid',
            total: 800,
            amountPaid: 800,
            documentType: 'receipt',
        },
        {
            date: '2026-02-13T00:00:00.000Z',
            status: 'paid',
            total: 1000,
            amountPaid: 300,
            documentType: 'receipt',
        },
    ];

    const summary = computePeriodSummaryFromDocs(docs, 2026, 2, 'UTC');

    assert.equal(summary.receiptsIssued, 1);
    assert.equal(summary.paymentsReceived, 1);
});

test('computePercentChange handles zero and near-zero baselines', () => {
    assert.deepEqual(computePercentChange(0, 0), { kind: 'flat', direction: 'flat' });
    assert.deepEqual(computePercentChange(100, 0), { kind: 'new', direction: 'up' });
    assert.deepEqual(computeMoneyPercentChange(6314500, 20), {
        kind: 'unavailable',
        direction: 'flat',
    });
    assert.deepEqual(computeMoneyPercentChange(6314500, 20000), {
        kind: 'capped',
        value: 999,
        direction: 'up',
    });
    assert.deepEqual(computeMoneyPercentChange(705000, 612000), {
        kind: 'percent',
        value: 15,
        direction: 'up',
    });
    assert.deepEqual(computeCountPercentChange(5, 0), { kind: 'new', direction: 'up' });
    assert.deepEqual(computeCountPercentChange(13, 1), {
        kind: 'capped',
        value: 999,
        direction: 'up',
    });
    assert.deepEqual(computeCountPercentChange(4, 1), {
        kind: 'percent',
        value: 300,
        direction: 'up',
    });
    assert.deepEqual(computeCountPercentChange(79, 72), {
        kind: 'percent',
        value: 10,
        direction: 'up',
    });
});

test('buildPeriodSummaryFromDocs omits comparison for all-time', () => {
    const docs = [
        {
            date: '2026-01-10T00:00:00.000Z',
            status: 'paid',
            total: 400,
            amountPaid: 400,
            documentType: 'invoice',
        },
        {
            date: '2026-02-10T00:00:00.000Z',
            status: 'paid',
            total: 600,
            amountPaid: 600,
            documentType: 'invoice',
        },
    ];

    const summary = buildPeriodSummaryFromDocs(docs, {
        period: { kind: 'all' },
        timeZone: 'UTC',
    });

    assert.equal(summary.period.kind, 'all');
    assert.equal(summary.period.label, 'All time');
    assert.equal(summary.current.totalRevenue, 1000);
    assert.equal(summary.comparison, null);
});

test('buildPeriodSummaryFromDocs compares today to yesterday', () => {
    const docs = [
        {
            date: '2026-08-14T12:00:00.000Z',
            status: 'paid',
            total: 12000,
            amountPaid: 12000,
            documentType: 'invoice',
        },
        {
            date: '2026-08-13T12:00:00.000Z',
            status: 'paid',
            total: 6000,
            amountPaid: 6000,
            documentType: 'invoice',
        },
    ];

    const summary = buildPeriodSummaryFromDocs(docs, {
        period: { kind: 'day', year: 2026, month: 8, day: 14 },
        timeZone: 'UTC',
    });

    assert.equal(summary.period.kind, 'day');
    assert.equal(summary.period.label, 'Today');
    assert.equal(summary.current.totalRevenue, 12000);
    assert.equal(summary.previous.totalRevenue, 6000);
    assert.equal(summary.comparison.totalRevenue.direction, 'up');
});
