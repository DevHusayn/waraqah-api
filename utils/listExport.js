import BusinessInfo from '../models/CompanyInfo.js';

export const LIST_EXPORT_MAX = 5000;

export function slugifyFilenamePart(value, fallback = 'export') {
    const slug = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);
    return slug || fallback;
}

export function buildListExportFilename(companyName, resource, query = {}) {
    const parts = [
        slugifyFilenamePart(companyName, 'business'),
        slugifyFilenamePart(resource, 'export'),
    ];

    const filterParts = [];
    const period = String(query.period || '').trim().toLowerCase();
    const year = query.year != null && query.year !== '' ? Number(query.year) : null;
    const month = query.month != null && query.month !== '' ? Number(query.month) : null;
    if (period === 'today') {
        filterParts.push('today');
    } else if (period === 'last-week' || period === 'lastweek') {
        filterParts.push('last-week');
    } else if (period === 'last-month' || period === 'lastmonth') {
        filterParts.push('last-month');
    } else if (Number.isFinite(year) && Number.isFinite(month)) {
        filterParts.push(`${year}-${String(month).padStart(2, '0')}`);
    }
    const status = String(query.status || 'all').trim().toLowerCase();
    if (status && status !== 'all') {
        filterParts.push(status);
    }
    if (String(query.search || '').trim()) {
        filterParts.push('search');
    }
    if (filterParts.length > 0) {
        parts.push(filterParts.join('-'));
    }
    parts.push('filtered');
    parts.push(new Date().toISOString().slice(0, 10));

    return `${parts.join('-')}.csv`;
}

export function escapeCsvField(value) {
    const str = value == null ? '' : String(value);
    if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function isPreformattedCsvField(value) {
    const str = String(value ?? '');
    return str.startsWith('"="') && str.endsWith('"');
}

/** Excel text formula so dates display literally and avoid auto date conversion. */
export function excelTextCsvField(value) {
    const str = value == null ? '' : String(value);
    if (!str) return '';
    const formula = `="${str.replace(/"/g, '""')}"`;
    return `"${formula.replace(/"/g, '""')}"`;
}

export function rowsToCsv(headers, rows) {
    const headerLine = headers.map(escapeCsvField).join(',');
    const body = rows.map((row) =>
        row.map((cell) => (isPreformattedCsvField(cell) ? cell : escapeCsvField(cell))).join(',')
    );
    return [headerLine, ...body].join('\r\n');
}

export function assertExportWithinLimit(total) {
    if (total > LIST_EXPORT_MAX) {
        const err = new Error(
            `Export limited to ${LIST_EXPORT_MAX.toLocaleString()} rows. Narrow your filters and try again.`
        );
        err.status = 400;
        throw err;
    }
}

export function sendListCsvResponse(res, filename, csv) {
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(`\uFEFF${csv}`);
}

function normalizeListExportDate(value) {
    if (!value) return '';
    if (value instanceof Date) {
        return value.toISOString().slice(0, 10);
    }
    const str = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        return str.slice(0, 10);
    }
    const parsed = new Date(str);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
    }
    return str;
}

/** Date cell for list CSV exports — forces Excel to keep YYYY-MM-DD as text. */
export function formatListExportDate(value) {
    const normalized = normalizeListExportDate(value);
    return normalized ? excelTextCsvField(normalized) : '';
}

export async function resolveListExportFilename(userId, resource, query = {}) {
    const business = await BusinessInfo.findOne({ userId }).select('name').lean();
    return buildListExportFilename(business?.name, resource, query);
}
