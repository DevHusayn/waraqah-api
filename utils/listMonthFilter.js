import {
    getBusinessTimezone,
    getDatePartsInTimezone,
    getUtcRangeForDayInTimezone,
    getUtcRangeForMonthInTimezone,
    getUtcRangeForDateRangeInTimezone,
    getUtcRangeForWeekInTimezone,
    getUtcRangeForYearInTimezone,
    getWeekBoundsInTimezone,
    getLastWeekBoundsInTimezone,
    getLastYearMonthInTimezone,
    parseDateInputValue,
    toDateInputValue,
    shiftDateByDays,
} from './timezone.js';

/** Parse year/month list filter query params. Returns null when absent or invalid. */
export function parseListMonthQuery(query = {}) {
    const year = Number.parseInt(String(query.year ?? ''), 10);
    const month = Number.parseInt(String(query.month ?? ''), 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return null;
    }
    return { year, month };
}

/** Parse list period. null / all = all-time (no date filter). */
export function parseListPeriodQuery(query = {}) {
    const raw = String(query.period ?? '').trim().toLowerCase();
    if (raw === 'all' || raw === 'alltime' || raw === 'all-time') {
        return { kind: 'all' };
    }
    if (raw === 'today') {
        return { kind: 'today' };
    }
    if (raw === 'week') {
        return { kind: 'week' };
    }
    if (raw === 'last-week' || raw === 'lastweek') {
        return { kind: 'last-week' };
    }
    if (raw === 'last-month' || raw === 'lastmonth') {
        return { kind: 'last-month' };
    }
    if (raw === 'year') {
        return { kind: 'year' };
    }
    if (raw === 'custom') {
        const start = parseDateInputValue(query.startDate);
        const end = parseDateInputValue(query.endDate);
        if (!start || !end) return null;
        if (
            start.year > end.year ||
            (start.year === end.year && start.month > end.month) ||
            (start.year === end.year && start.month === end.month && start.day > end.day)
        ) {
            return null;
        }
        return { kind: 'custom', start, end };
    }
    const month = parseListMonthQuery(query);
    if (month) return { kind: 'month', ...month };
    if (raw === 'month') return { kind: 'month-current' };
    return null;
}

/** Filter documents by issue date string (YYYY-MM-DD) within a calendar month. */
export function buildIssueDateMonthFilter(year, month) {
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return null;
    }
    const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const endStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    return { date: { $gte: startStr, $lt: endStr } };
}

export function buildIssueDateDayFilter(year, month, day) {
    if (
        !Number.isFinite(year) ||
        !Number.isFinite(month) ||
        !Number.isFinite(day) ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31
    ) {
        return null;
    }
    const startStr = toDateInputValue(year, month, day);
    const next = shiftDateByDays(year, month, day, 1);
    const endStr = toDateInputValue(next.year, next.month, next.day);
    return { date: { $gte: startStr, $lt: endStr } };
}

export function buildIssueDateRangeFilter(start, end) {
    if (!start || !end) return null;
    const startStr = toDateInputValue(start.year, start.month, start.day);
    const next = shiftDateByDays(end.year, end.month, end.day, 1);
    const endStr = toDateInputValue(next.year, next.month, next.day);
    return { date: { $gte: startStr, $lt: endStr } };
}

export function buildIssueDateYearFilter(year) {
    return buildIssueDateRangeFilter(
        { year, month: 1, day: 1 },
        { year, month: 12, day: 31 }
    );
}

/**
 * Mongo date filter for list endpoints.
 * dateField 'date' uses YYYY-MM-DD string ranges; 'createdAt' uses timezone UTC instants.
 */
export async function getListPeriodMongoFilter(query, userId, { dateField = 'date' } = {}) {
    const parsed = parseListPeriodQuery(query);
    if (!parsed || parsed.kind === 'all') return null;

    const timeZone = await getBusinessTimezone(userId);

    if (dateField === 'createdAt') {
        if (parsed.kind === 'today') {
            const parts = getDatePartsInTimezone(timeZone);
            const { start, end } = getUtcRangeForDayInTimezone(
                parts.year,
                parts.month,
                parts.day,
                timeZone
            );
            return { createdAt: { $gte: start, $lt: end } };
        }
        if (parsed.kind === 'week') {
            const { start, end } = getUtcRangeForWeekInTimezone(timeZone);
            return { createdAt: { $gte: start, $lt: end } };
        }
        if (parsed.kind === 'last-week') {
            const bounds = getLastWeekBoundsInTimezone(timeZone);
            const { start, end } = getUtcRangeForDateRangeInTimezone(bounds.start, bounds.end, timeZone);
            return { createdAt: { $gte: start, $lt: end } };
        }
        if (parsed.kind === 'year') {
            const { year } = getDatePartsInTimezone(timeZone);
            const { start, end } = getUtcRangeForYearInTimezone(year, timeZone);
            return { createdAt: { $gte: start, $lt: end } };
        }
        if (parsed.kind === 'custom') {
            const { start, end } = getUtcRangeForDateRangeInTimezone(parsed.start, parsed.end, timeZone);
            return { createdAt: { $gte: start, $lt: end } };
        }
        if (parsed.kind === 'month-current') {
            const parts = getDatePartsInTimezone(timeZone);
            const { start, end } = getUtcRangeForMonthInTimezone(parts.year, parts.month, timeZone);
            return { createdAt: { $gte: start, $lt: end } };
        }
        if (parsed.kind === 'last-month') {
            const lastMonth = getLastYearMonthInTimezone(timeZone);
            const { start, end } = getUtcRangeForMonthInTimezone(lastMonth.year, lastMonth.month, timeZone);
            return { createdAt: { $gte: start, $lt: end } };
        }
        const { start, end } = getUtcRangeForMonthInTimezone(parsed.year, parsed.month, timeZone);
        return { createdAt: { $gte: start, $lt: end } };
    }

    if (parsed.kind === 'today') {
        const parts = getDatePartsInTimezone(timeZone);
        return buildIssueDateDayFilter(parts.year, parts.month, parts.day);
    }
    if (parsed.kind === 'week') {
        const { start, end } = getWeekBoundsInTimezone(timeZone);
        return buildIssueDateRangeFilter(start, end);
    }
    if (parsed.kind === 'last-week') {
        const { start, end } = getLastWeekBoundsInTimezone(timeZone);
        return buildIssueDateRangeFilter(start, end);
    }
    if (parsed.kind === 'year') {
        const { year } = getDatePartsInTimezone(timeZone);
        return buildIssueDateYearFilter(year);
    }
    if (parsed.kind === 'custom') {
        return buildIssueDateRangeFilter(parsed.start, parsed.end);
    }
    if (parsed.kind === 'month-current') {
        const parts = getDatePartsInTimezone(timeZone);
        return buildIssueDateMonthFilter(parts.year, parts.month);
    }
    if (parsed.kind === 'last-month') {
        const lastMonth = getLastYearMonthInTimezone(timeZone);
        return buildIssueDateMonthFilter(lastMonth.year, lastMonth.month);
    }

    return buildIssueDateMonthFilter(parsed.year, parsed.month);
}
