import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getUtcRangeForMonthInTimezone,
    getUtcRangeForDayInTimezone,
    getYearMonthInTimezone,
    normalizeTimezone,
    parseSummaryPeriodQuery,
    parsePeriodQuery,
    resolveAnalyticsPeriod,
    previousAnalyticsPeriod,
    periodCacheKey,
    dateMatchesPeriod,
} from '../utils/timezone.js';

test('normalizeTimezone falls back for invalid values', () => {
    assert.equal(normalizeTimezone(''), 'Africa/Lagos');
    assert.equal(normalizeTimezone('Not/AZone'), 'Africa/Lagos');
    assert.equal(normalizeTimezone('Europe/London'), 'Europe/London');
});

test('getUtcRangeForMonthInTimezone covers August 2026 in Lagos', () => {
    const { start, end } = getUtcRangeForMonthInTimezone(2026, 8, 'Africa/Lagos');
    assert.equal(start.toISOString(), '2026-07-31T23:00:00.000Z');
    assert.equal(end.toISOString(), '2026-08-31T23:00:00.000Z');
});

test('getUtcRangeForDayInTimezone covers 14 Aug 2026 in Lagos', () => {
    const { start, end } = getUtcRangeForDayInTimezone(2026, 8, 14, 'Africa/Lagos');
    assert.equal(start.toISOString(), '2026-08-13T23:00:00.000Z');
    assert.equal(end.toISOString(), '2026-08-14T23:00:00.000Z');
});

test('parseSummaryPeriodQuery defaults to business timezone month', () => {
    const period = parseSummaryPeriodQuery({}, 'Africa/Lagos');
    const current = getYearMonthInTimezone('Africa/Lagos');
    assert.deepEqual(period, current);
});

test('parseSummaryPeriodQuery accepts explicit summary month', () => {
    assert.deepEqual(parseSummaryPeriodQuery({ summaryYear: '2025', summaryMonth: '3' }, 'Africa/Lagos'), {
        year: 2025,
        month: 3,
    });
});

test('parsePeriodQuery returns all / today / month and null default', () => {
    assert.deepEqual(parsePeriodQuery({ period: 'all' }, 'Africa/Lagos'), { kind: 'all' });
    const today = parsePeriodQuery(
        { period: 'today' },
        'Africa/Lagos',
        new Date('2026-08-14T12:00:00.000Z')
    );
    assert.deepEqual(today, { kind: 'day', year: 2026, month: 8, day: 14 });
    assert.deepEqual(
        parsePeriodQuery({ period: 'month', summaryYear: '2026', summaryMonth: '3' }, 'Africa/Lagos'),
        { kind: 'month', year: 2026, month: 3 }
    );
    assert.equal(parsePeriodQuery({}, 'Africa/Lagos'), null);
});

test('resolveAnalyticsPeriod keeps omit-params as current month', () => {
    const resolved = resolveAnalyticsPeriod({}, 'Africa/Lagos');
    const current = getYearMonthInTimezone('Africa/Lagos');
    assert.equal(resolved.kind, 'month');
    assert.equal(resolved.year, current.year);
    assert.equal(resolved.month, current.month);
});

test('previousAnalyticsPeriod and cache keys', () => {
    assert.equal(previousAnalyticsPeriod({ kind: 'all' }), null);
    assert.deepEqual(previousAnalyticsPeriod({ kind: 'day', year: 2026, month: 8, day: 1 }), {
        kind: 'day',
        year: 2026,
        month: 7,
        day: 31,
    });
    assert.equal(periodCacheKey({ kind: 'all' }), 'all');
    assert.equal(periodCacheKey({ kind: 'day', year: 2026, month: 8, day: 14 }), 'today:2026-08-14');
    assert.equal(periodCacheKey({ kind: 'month', year: 2026, month: 8 }), 'month:2026-08');
    assert.equal(periodCacheKey({ kind: 'year', year: 2026 }), 'year:2026');
    assert.equal(
        periodCacheKey({
            kind: 'range',
            startYear: 2026,
            startMonth: 1,
            startDay: 1,
            endYear: 2026,
            endMonth: 1,
            endDay: 15,
        }),
        'range:2026-01-01:2026-01-15'
    );
});

test('parsePeriodQuery supports week, year, and custom range', () => {
    const now = new Date('2026-08-14T12:00:00.000Z');
    const week = parsePeriodQuery({ period: 'week' }, 'Africa/Lagos', now);
    assert.equal(week.kind, 'week');
    assert.deepEqual(week, {
        kind: 'week',
        startYear: 2026,
        startMonth: 8,
        startDay: 9,
        endYear: 2026,
        endMonth: 8,
        endDay: 15,
    });
    assert.deepEqual(
        parsePeriodQuery({ period: 'last-week' }, 'Africa/Lagos', now),
        {
            kind: 'week',
            startYear: 2026,
            startMonth: 8,
            startDay: 2,
            endYear: 2026,
            endMonth: 8,
            endDay: 8,
        }
    );
    assert.deepEqual(parsePeriodQuery({ period: 'last-month' }, 'Africa/Lagos', now), {
        kind: 'month',
        year: 2026,
        month: 7,
    });
    assert.deepEqual(parsePeriodQuery({ period: 'year' }, 'Africa/Lagos', now), {
        kind: 'year',
        year: 2026,
    });
    assert.deepEqual(
        parsePeriodQuery(
            { period: 'custom', startDate: '2026-08-01', endDate: '2026-08-07' },
            'Africa/Lagos',
            now
        ),
        {
            kind: 'range',
            startYear: 2026,
            startMonth: 8,
            startDay: 1,
            endYear: 2026,
            endMonth: 8,
            endDay: 7,
        }
    );
});

test('dateMatchesPeriod handles week, year, and range', () => {
    const week = {
        kind: 'week',
        startYear: 2026,
        startMonth: 8,
        startDay: 9,
        endYear: 2026,
        endMonth: 8,
        endDay: 15,
    };
    assert.equal(dateMatchesPeriod('2026-08-12', week, 'Africa/Lagos'), true);
    assert.equal(dateMatchesPeriod('2026-08-08', week, 'Africa/Lagos'), false);
    assert.equal(dateMatchesPeriod('2026-08-14', { kind: 'year', year: 2026 }, 'Africa/Lagos'), true);
    assert.equal(dateMatchesPeriod('2025-12-31', { kind: 'year', year: 2026 }, 'Africa/Lagos'), false);
    const range = {
        kind: 'range',
        startYear: 2026,
        startMonth: 8,
        startDay: 1,
        endYear: 2026,
        endMonth: 8,
        endDay: 7,
    };
    assert.equal(dateMatchesPeriod('2026-08-07', range, 'Africa/Lagos'), true);
    assert.equal(dateMatchesPeriod('2026-08-08', range, 'Africa/Lagos'), false);
});
