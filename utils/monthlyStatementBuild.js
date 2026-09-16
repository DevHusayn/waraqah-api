import {
    startOfMonth,
    endOfMonth,
    parseISO,
    format,
    isValid,
    isWithinInterval,
} from 'date-fns';

const STATUSES = ['paid', 'partial', 'pending', 'overdue', 'cancelled'];
const MONEY_EPS = 0.009;

function emptyBucketTotals() {
    return {
        paid: 0,
        partial: 0,
        pending: 0,
        overdue: 0,
        cancelled: 0,
    };
}

function emptyTotals() {
    return {
        ...emptyBucketTotals(),
        total: 0,
        documentCount: 0,
    };
}

function roundMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
}

function getInvoiceAmountPaid(invoice) {
    if (!invoice) return 0;
    const recorded = roundMoney(invoice.amountPaid);
    if (recorded > 0) return recorded;
    if (invoice.status === 'paid') {
        return roundMoney(invoice.total);
    }
    return 0;
}

function getInvoiceBalanceDue(invoice) {
    const total = roundMoney(invoice?.total);
    return Math.max(0, roundMoney(total - getInvoiceAmountPaid(invoice)));
}

function isReceiptOnly(doc) {
    return doc?.documentType === 'receipt';
}

function isPartialReceipt(doc) {
    if (!isReceiptOnly(doc)) return false;
    const total = Number(doc?.total) || 0;
    if (total <= 0) return false;
    const paid = getInvoiceAmountPaid(doc);
    return paid > 0 && total - paid > MONEY_EPS;
}

function getClientBusiness(client) {
    if (!client) return '';
    return client.business || client.company || '';
}

function parseInvoiceDate(dateStr) {
    if (!dateStr) return null;
    const raw = String(dateStr).slice(0, 10);
    const d = parseISO(raw);
    return isValid(d) ? d : null;
}

function normalizeInvoiceStatus(status) {
    if (status === 'canceled') return 'cancelled';
    if (status === 'partial') return 'partial';
    if (STATUSES.includes(status)) return status;
    return 'pending';
}

function allocateStatementAmounts(doc) {
    const buckets = emptyBucketTotals();
    const total = Number(doc?.total) || 0;
    if (total <= 0) return buckets;

    if (doc.status === 'cancelled' || doc.status === 'canceled') {
        buckets.cancelled = total;
        return buckets;
    }

    if (doc.status === 'draft') {
        return buckets;
    }

    if (isReceiptOnly(doc)) {
        if (isPartialReceipt(doc)) {
            buckets.paid = getInvoiceAmountPaid(doc);
            buckets.partial = getInvoiceBalanceDue(doc);
        } else {
            buckets.paid = total;
        }
        return buckets;
    }

    const status = normalizeInvoiceStatus(doc.status);
    if (status === 'partial') {
        buckets.paid = getInvoiceAmountPaid(doc);
        buckets.partial = getInvoiceBalanceDue(doc);
        return buckets;
    }

    buckets[status] = total;
    return buckets;
}

export function buildMonthlyStatement({
    invoices = [],
    receipts = [],
    clients = [],
    year,
    month,
}) {
    const periodStart = startOfMonth(new Date(year, month - 1, 1));
    const periodEnd = endOfMonth(periodStart);
    const clientById = Object.fromEntries(clients.map((c) => [c.id, c]));
    const documents = [...invoices, ...receipts];

    const inPeriod = documents.filter((doc) => {
        const d = parseInvoiceDate(doc.date);
        return d && isWithinInterval(d, { start: periodStart, end: periodEnd });
    });

    const byClientId = {};

    for (const doc of inPeriod) {
        if (doc.status === 'draft') continue;

        const clientId = doc.clientId;
        const client = clientById[clientId];
        if (!byClientId[clientId]) {
            const business = getClientBusiness(client);
            byClientId[clientId] = {
                clientId,
                clientName: client?.name || doc.clientName || 'Unknown client',
                clientSubtitle: business || client?.email || '',
                ...emptyBucketTotals(),
                total: 0,
                documentCount: 0,
            };
        }

        const row = byClientId[clientId];
        const allocation = allocateStatementAmounts(doc);
        const docTotal = Number(doc.total) || 0;

        for (const status of STATUSES) {
            row[status] += allocation[status];
        }
        row.total += docTotal;
        row.documentCount += 1;
    }

    const rows = Object.values(byClientId).sort((a, b) =>
        a.clientName.localeCompare(b.clientName),
    );

    const totals = emptyTotals();
    totals.documentCount = inPeriod.filter((doc) => doc.status !== 'draft').length;
    for (const row of rows) {
        for (const status of STATUSES) totals[status] += row[status];
        totals.total += row.total;
    }

    return {
        periodLabel: format(periodStart, 'MMMM yyyy'),
        periodStart,
        periodEnd,
        generatedAt: new Date(),
        rows,
        totals,
        hasData: rows.length > 0,
    };
}

export function formatStatementPeriodKey(year, month) {
    return `${year}-${String(month).padStart(2, '0')}`;
}

const CURRENCY_SYMBOLS = {
    NGN: '₦',
    GHS: 'GH₵',
    ZAR: 'R',
    KES: 'KSh',
    USD: '$',
    EUR: '€',
};

export function getStatementCurrencySymbol(code = 'NGN') {
    const normalized = String(code || 'NGN').toUpperCase();
    try {
        const parts = new Intl.NumberFormat('en', {
            style: 'currency',
            currency: normalized,
            currencyDisplay: 'narrowSymbol',
        }).formatToParts(0);
        return parts.find((part) => part.type === 'currency')?.value || normalized;
    } catch {
        return CURRENCY_SYMBOLS[normalized] || CURRENCY_SYMBOLS.NGN;
    }
}
