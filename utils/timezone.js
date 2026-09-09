import BusinessInfo from '../models/CompanyInfo.js';

export const DEFAULT_BUSINESS_TIMEZONE = 'Africa/Lagos';

export function normalizeTimezone(value) {
    const tz = String(value || '').trim();
    if (!tz || !isValidTimezone(tz)) return DEFAULT_BUSINESS_TIMEZONE;
    return tz;
}

export function isValidTimezone(timeZone) {
    try {
        Intl.DateTimeFormat(undefined, { timeZone });
        return true;
    } catch {
        return false;
    }
}

export function getDatePartsInTimezone(timeZone, date = new Date()) {
    const tz = normalizeTimezone(timeZone);
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        })
            .formatToParts(date)
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, part.value])
    );
    return {
        year: Number.parseInt(parts.year, 10),
        month: Number.parseInt(parts.month, 10),
        day: Number.parseInt(parts.day, 10),
    };
}

export function getYearMonthInTimezone(timeZone, date = new Date()) {
    const { year, month } = getDatePartsInTimezone(timeZone, date);
    return { year, month };
}

export function toDateInputValue(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function shiftDateByDays(year, month, day, deltaDays) {
    const utc = new Date(Date.UTC(year, month - 1, day + deltaDays));
    return {
        year: utc.getUTCFullYear(),
        month: utc.getUTCMonth() + 1,
        day: utc.getUTCDate(),
    };
}

const WEEK_STARTS_ON = 0;

export function parseDateInputValue(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const day = Number.parseInt(match[3], 10);
    if (
        !Number.isFinite(year) ||
        !Number.isFinite(month) ||
        !Number.isFinite(day) ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31 ||
        year < 1970 ||
        year > 2100
    ) {
        return null;
    }
    return { year, month, day };
}

function compareDateParts(a, b) {
    if (a.year !== b.year) return a.year - b.year;
    if (a.month !== b.month) return a.month - b.month;
    return a.day - b.day;
}

function isDateWithinInclusiveRange(parts, start, end) {
    return compareDateParts(parts, start) >= 0 && compareDateParts(parts, end) <= 0;
}

function getWeekdayInTimezone(timeZone, date = new Date()) {
    const tz = normalizeTimezone(timeZone);
    const weekday = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short',
    }).format(date);
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[weekday] ?? 0;
}

/** Current calendar week (Sun–Sat) in the business timezone. */
export function getWeekBoundsInTimezone(timeZone, now = new Date()) {
    const today = getDatePartsInTimezone(timeZone, now);
    const weekday = getWeekdayInTimezone(timeZone, now);
    const daysFromStart = (weekday - WEEK_STARTS_ON + 7) % 7;
    const start = shiftDateByDays(today.year, today.month, today.day, -daysFromStart);
    const end = shiftDateByDays(start.year, start.month, start.day, 6);
    return { start, end };
}

export function getLastWeekBoundsInTimezone(timeZone, now = new Date()) {
    const { start } = getWeekBoundsInTimezone(timeZone, now);
    const prevStart = shiftDateByDays(start.year, start.month, start.day, -7);
    const prevEnd = shiftDateByDays(prevStart.year, prevStart.month, prevStart.day, 6);
    return { start: prevStart, end: prevEnd };
}

export function getLastYearMonthInTimezone(timeZone, now = new Date()) {
    const { year, month } = getYearMonthInTimezone(timeZone, now);
    const index = year * 12 + (month - 1) - 1;
    return {
        year: Math.floor(index / 12),
        month: (index % 12) + 1,
    };
}

function buildRangePeriod(start, end) {
    return {
        kind: 'range',
        startYear: start.year,
        startMonth: start.month,
        startDay: start.day,
        endYear: end.year,
        endMonth: end.month,
        endDay: end.day,
    };
}

function buildWeekPeriod(start, end) {
    return {
        kind: 'week',
        startYear: start.year,
        startMonth: start.month,
        startDay: start.day,
        endYear: end.year,
        endMonth: end.month,
        endDay: end.day,
    };
}

function parseCustomRangeQuery(query = {}) {
    const start = parseDateInputValue(query.startDate);
    const end = parseDateInputValue(query.endDate);
    if (!start || !end) return null;
    if (compareDateParts(start, end) > 0) return null;
    return buildRangePeriod(start, end);
}

function parseMonthParts(query = {}) {
    const year = Number.parseInt(String(query.summaryYear ?? query.year ?? ''), 10);
    const month = Number.parseInt(String(query.summaryMonth ?? query.month ?? ''), 10);
    if (
        Number.isFinite(year) &&
        Number.isFinite(month) &&
        month >= 1 &&
        month <= 12 &&
        year >= 1970 &&
        year <= 2100
    ) {
        return { year, month };
    }
    return null;
}

/**
 * Explicit period query. Returns null when callers should keep their existing default
 * (current month for summaries, all-time for lists).
 */
export function parsePeriodQuery(query = {}, timeZone, now = new Date()) {
    const raw = String(query.period ?? '').trim().toLowerCase();
    if (raw === 'all' || raw === 'alltime' || raw === 'all-time') {
        return { kind: 'all' };
    }
    if (raw === 'today') {
        return { kind: 'day', ...getDatePartsInTimezone(timeZone, now) };
    }
    if (raw === 'week') {
        const { start, end } = getWeekBoundsInTimezone(timeZone, now);
        return buildWeekPeriod(start, end);
    }
    if (raw === 'last-week' || raw === 'lastweek') {
        const { start, end } = getLastWeekBoundsInTimezone(timeZone, now);
        return buildWeekPeriod(start, end);
    }
    if (raw === 'last-month' || raw === 'lastmonth') {
        return { kind: 'month', ...getLastYearMonthInTimezone(timeZone, now) };
    }
    if (raw === 'year') {
        const { year } = getDatePartsInTimezone(timeZone, now);
        return { kind: 'year', year };
    }
    if (raw === 'custom') {
        const range = parseCustomRangeQuery(query);
        if (range) return range;
        return null;
    }

    const monthParts = parseMonthParts(query);
    if (raw === 'month') {
        if (monthParts) return { kind: 'month', ...monthParts };
        return { kind: 'month', ...getYearMonthInTimezone(timeZone, now) };
    }

    if (monthParts) return { kind: 'month', ...monthParts };
    return null;
}

export function resolveAnalyticsPeriod(query = {}, timeZone, now = new Date()) {
    const parsed = parsePeriodQuery(query, timeZone, now);
    if (parsed) return parsed;
    const { year, month } = parseSummaryPeriodQuery(query, timeZone);
    return { kind: 'month', year, month };
}

export function dateMatchesPeriod(dateValue, period, timeZone) {
    if (!period || period.kind === 'all') return true;
    if (!dateValue) return false;
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return false;
    const parts = getDatePartsInTimezone(timeZone, date);
    if (period.kind === 'day') {
        return parts.year === period.year && parts.month === period.month && parts.day === period.day;
    }
    if (period.kind === 'month') {
        return parts.year === period.year && parts.month === period.month;
    }
    if (period.kind === 'year') {
        return parts.year === period.year;
    }
    if (period.kind === 'week' || period.kind === 'range') {
        const start = {
            year: period.startYear,
            month: period.startMonth,
            day: period.startDay,
        };
        const end = { year: period.endYear, month: period.endMonth, day: period.endDay };
        return isDateWithinInclusiveRange(parts, start, end);
    }
    return false;
}

function countInclusiveDays(start, end) {
    let count = 0;
    let cursor = { ...start };
    while (compareDateParts(cursor, end) <= 0) {
        count += 1;
        if (compareDateParts(cursor, end) === 0) break;
        cursor = shiftDateByDays(cursor.year, cursor.month, cursor.day, 1);
    }
    return count;
}

export function previousAnalyticsPeriod(period) {
    if (!period || period.kind === 'all') return null;
    if (period.kind === 'day') {
        return { kind: 'day', ...shiftDateByDays(period.year, period.month, period.day, -1) };
    }
    if (period.kind === 'month') {
        const index = period.year * 12 + (period.month - 1) - 1;
        return {
            kind: 'month',
            year: Math.floor(index / 12),
            month: (index % 12) + 1,
        };
    }
    if (period.kind === 'year') {
        return { kind: 'year', year: period.year - 1 };
    }
    if (period.kind === 'week') {
        const start = {
            year: period.startYear,
            month: period.startMonth,
            day: period.startDay,
        };
        const prevStart = shiftDateByDays(start.year, start.month, start.day, -7);
        const prevEnd = shiftDateByDays(prevStart.year, prevStart.month, prevStart.day, 6);
        return buildWeekPeriod(prevStart, prevEnd);
    }
    if (period.kind === 'range') {
        const start = {
            year: period.startYear,
            month: period.startMonth,
            day: period.startDay,
        };
        const end = { year: period.endYear, month: period.endMonth, day: period.endDay };
        const days = countInclusiveDays(start, end);
        const prevEnd = shiftDateByDays(start.year, start.month, start.day, -1);
        const prevStart = shiftDateByDays(prevEnd.year, prevEnd.month, prevEnd.day, -(days - 1));
        return buildRangePeriod(prevStart, prevEnd);
    }
    return null;
}

function formatDatePartsLabel({ year, month, day }, locale = 'en-US', options = {}) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(date);
}

export function formatDateRangeLabel(start, end, locale = 'en-US') {
    const sameYear = start.year === end.year;
    const startLabel = formatDatePartsLabel(start, locale, {
        month: 'short',
        day: 'numeric',
        year: sameYear ? undefined : 'numeric',
    });
    const endLabel = formatDatePartsLabel(end, locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
    return `${startLabel} – ${endLabel}`;
}

export function formatAnalyticsPeriodLabel(period, locale = 'en-US', timeZone = DEFAULT_BUSINESS_TIMEZONE) {
    if (!period || period.kind === 'all') return 'All time';
    if (period.kind === 'day') return 'Today';
    if (period.kind === 'week') {
        const currentWeek = getWeekBoundsInTimezone(timeZone);
        const isCurrentWeek =
            period.startYear === currentWeek.start.year &&
            period.startMonth === currentWeek.start.month &&
            period.startDay === currentWeek.start.day;
        if (isCurrentWeek) return 'This week';
        const lastWeek = getLastWeekBoundsInTimezone(timeZone);
        const isLastWeek =
            period.startYear === lastWeek.start.year &&
            period.startMonth === lastWeek.start.month &&
            period.startDay === lastWeek.start.day;
        if (isLastWeek) return 'Last week';
        return formatDateRangeLabel(
            { year: period.startYear, month: period.startMonth, day: period.startDay },
            { year: period.endYear, month: period.endMonth, day: period.endDay },
            locale
        );
    }
    if (period.kind === 'year') {
        const currentYear = getDatePartsInTimezone(timeZone).year;
        if (period.year === currentYear) return 'This year';
        return String(period.year);
    }
    if (period.kind === 'range') {
        return formatDateRangeLabel(
            { year: period.startYear, month: period.startMonth, day: period.startDay },
            { year: period.endYear, month: period.endMonth, day: period.endDay },
            locale
        );
    }
    const lastMonth = getLastYearMonthInTimezone(timeZone);
    if (period.year === lastMonth.year && period.month === lastMonth.month) return 'Last month';
    const date = new Date(Date.UTC(period.year, period.month - 1, 1));
    return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
        date
    );
}

export function periodCacheKey(period) {
    if (!period || period.kind === 'all') return 'all';
    if (period.kind === 'day') {
        return `today:${toDateInputValue(period.year, period.month, period.day)}`;
    }
    if (period.kind === 'week') {
        return `week:${toDateInputValue(period.startYear, period.startMonth, period.startDay)}`;
    }
    if (period.kind === 'year') {
        return `year:${period.year}`;
    }
    if (period.kind === 'range') {
        return `range:${toDateInputValue(period.startYear, period.startMonth, period.startDay)}:${toDateInputValue(period.endYear, period.endMonth, period.endDay)}`;
    }
    return `month:${period.year}-${String(period.month).padStart(2, '0')}`;
}

export function parseSummaryPeriodQuery(query, timeZone) {
    const year = Number.parseInt(String(query.summaryYear ?? ''), 10);
    const month = Number.parseInt(String(query.summaryMonth ?? ''), 10);
    if (
        Number.isFinite(year) &&
        Number.isFinite(month) &&
        month >= 1 &&
        month <= 12 &&
        year >= 1970 &&
        year <= 2100
    ) {
        return { year, month };
    }
    return getYearMonthInTimezone(timeZone);
}

function zonedWallClockToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
    const tz = normalizeTimezone(timeZone);
    let timestamp = Date.UTC(year, month - 1, day, hour, minute, second);
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
        const parts = Object.fromEntries(
            formatter
                .formatToParts(new Date(timestamp))
                .filter((part) => part.type !== 'literal')
                .map((part) => [part.type, part.value])
        );
        const asUtc = Date.UTC(
            Number.parseInt(parts.year, 10),
            Number.parseInt(parts.month, 10) - 1,
            Number.parseInt(parts.day, 10),
            Number.parseInt(parts.hour, 10),
            Number.parseInt(parts.minute, 10),
            Number.parseInt(parts.second, 10)
        );
        const desired = Date.UTC(year, month - 1, day, hour, minute, second);
        const delta = desired - asUtc;
        if (delta === 0) break;
        timestamp += delta;
    }

    return new Date(timestamp);
}

/** Inclusive start, exclusive end — UTC instants for a calendar month in a timezone. */
export function getUtcRangeForMonthInTimezone(year, month, timeZone) {
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    return {
        start: zonedWallClockToUtc({ year, month, day: 1 }, timeZone),
        end: zonedWallClockToUtc({ year: nextYear, month: nextMonth, day: 1 }, timeZone),
    };
}

/** Inclusive start, exclusive end — UTC instants for a calendar day in a timezone. */
export function getUtcRangeForDayInTimezone(year, month, day, timeZone) {
    const next = shiftDateByDays(year, month, day, 1);
    return {
        start: zonedWallClockToUtc({ year, month, day }, timeZone),
        end: zonedWallClockToUtc({ year: next.year, month: next.month, day: next.day }, timeZone),
    };
}

/** Inclusive start, exclusive end — UTC instants for an inclusive date range in a timezone. */
export function getUtcRangeForDateRangeInTimezone(start, end, timeZone) {
    const next = shiftDateByDays(end.year, end.month, end.day, 1);
    return {
        start: zonedWallClockToUtc({ year: start.year, month: start.month, day: start.day }, timeZone),
        end: zonedWallClockToUtc({ year: next.year, month: next.month, day: next.day }, timeZone),
    };
}

export function getUtcRangeForWeekInTimezone(timeZone, now = new Date()) {
    const { start, end } = getWeekBoundsInTimezone(timeZone, now);
    return getUtcRangeForDateRangeInTimezone(start, end, timeZone);
}

export function getUtcRangeForYearInTimezone(year, timeZone) {
    return getUtcRangeForDateRangeInTimezone(
        { year, month: 1, day: 1 },
        { year, month: 12, day: 31 },
        timeZone
    );
}

export async function getBusinessTimezone(userId) {
    const doc = await BusinessInfo.findOne({ userId }).select('timezone').lean();
    return normalizeTimezone(doc?.timezone);
}
