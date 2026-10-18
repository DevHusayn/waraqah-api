import { normalizeCurrency } from './locale.js';

export const INSIGHT_MORNING_START_HOUR = 8;
export const INSIGHT_MORNING_END_HOUR = 10;
export const INSIGHT_REPEAT_AFTER_DAYS = 3;
export const DUE_SOON_DAYS = 7;
export const INSIGHT_TAG = 'daily-insight';
export const PAYMENT_PUSH_TAG = 'payment-received';
export const PRODUCT_PUSH_TAG = 'product-update';
export const STATEMENT_PUSH_TAG = 'statement-ready';
export const PREMIUM_EXPIRY_PUSH_TAG = 'premium-expiry';
export const PRODUCT_PUSH_MIN_GAP_MS = 7 * 24 * 60 * 60 * 1000;

export function formatPushMoney(amount, currency) {
    const code = normalizeCurrency(currency);
    const value = Number(amount);
    const safe = Number.isFinite(value) ? value : 0;
    try {
        return new Intl.NumberFormat('en', {
            style: 'currency',
            currency: code,
            currencyDisplay: 'narrowSymbol',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        }).format(safe);
    } catch {
        return `${code} ${safe}`;
    }
}

function dueSoonSentence(dueSoonCount) {
    if (!dueSoonCount) return '';
    const verb = dueSoonCount === 1 ? 'is' : 'are';
    return ` ${dueSoonCount} ${verb} due in the next ${DUE_SOON_DAYS} days.`;
}

function stockSentence(lowOrOutCount) {
    const count = Number(lowOrOutCount) || 0;
    if (count <= 0) return '';
    const noun = count === 1 ? 'product is' : 'products are';
    return ` ${count} ${noun} low or out of stock.`;
}

/**
 * One briefing. Overdue wins, then this month's outstanding, then a real change in collected.
 * Returns null when there is nothing worth saying.
 */
export function chooseInsight({
    overdueCount = 0,
    overdueAmount = 0,
    outstanding = 0,
    collected = 0,
    collectedComparison = null,
    dueSoonCount = 0,
    lowOrOutCount = 0,
    currency = 'NGN',
} = {}) {
    const extra = `${dueSoonSentence(dueSoonCount)}${stockSentence(lowOrOutCount)}`;
    const stockKey = Number(lowOrOutCount) > 0 ? `:stock:${Number(lowOrOutCount)}` : '';

    if (overdueCount > 0 && overdueAmount > 0) {
        const noun = overdueCount === 1 ? 'invoice is' : 'invoices are';
        return {
            title: 'Overdue invoices',
            body: `${overdueCount} ${noun} overdue, ${formatPushMoney(overdueAmount, currency)} in total.${extra}`,
            url: '/invoices?status=overdue',
            tag: INSIGHT_TAG,
            fingerprint: `overdue:${overdueCount}:${overdueAmount}${stockKey}`,
        };
    }

    if (outstanding > 0) {
        return {
            title: 'Outstanding this month',
            body: `${formatPushMoney(outstanding, currency)} still outstanding on invoices issued this month.${extra}`,
            url: '/',
            tag: INSIGHT_TAG,
            fingerprint: `outstanding:${outstanding}${stockKey}`,
        };
    }

    const direction = collectedComparison?.direction;
    if (collected > 0 && (direction === 'up' || direction === 'down')) {
        const word = direction === 'up' ? 'up from' : 'down from';
        return {
            title: 'Collected this month',
            body: `${formatPushMoney(collected, currency)} collected this month, ${word} last month.`,
            url: '/',
            tag: INSIGHT_TAG,
            fingerprint: `collected:${collected}:${direction}${stockKey}`,
        };
    }

    return null;
}

export function daysBetweenLocalDates(earlier, later) {
    const start = String(earlier || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const end = String(later || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!start || !end) return null;
    const startUtc = Date.UTC(Number(start[1]), Number(start[2]) - 1, Number(start[3]));
    const endUtc = Date.UTC(Number(end[1]), Number(end[2]) - 1, Number(end[3]));
    return Math.round((endUtc - startUtc) / 86400000);
}

/** Quiet days, repeated numbers, and anything outside the local morning window are skipped. */
export function shouldSendInsight({
    localHour,
    localDate,
    lastSentLocalDate,
    fingerprint,
    previousFingerprint,
    fingerprintLocalDate,
} = {}) {
    if (!fingerprint || !localDate) return false;
    if (!Number.isFinite(localHour)) return false;
    if (localHour < INSIGHT_MORNING_START_HOUR || localHour > INSIGHT_MORNING_END_HOUR) return false;
    if (lastSentLocalDate && lastSentLocalDate === localDate) return false;
    if (fingerprint === previousFingerprint) {
        const age = daysBetweenLocalDates(fingerprintLocalDate, localDate);
        if (age == null || age < INSIGHT_REPEAT_AFTER_DAYS) return false;
    }
    return true;
}

export function buildStatementPush(periodLabel) {
    const period = String(periodLabel || '').trim() || 'Last month';
    return {
        title: 'Your statement is ready',
        body: `${period} statement is ready to download.`,
        url: '/statements',
        tag: STATEMENT_PUSH_TAG,
    };
}

export function buildPremiumExpiryPush(untilLabel) {
    const until = String(untilLabel || '').trim();
    return {
        title: 'Premium is ending',
        body: until ? `Premium access ends on ${until}.` : 'Premium access is about to end.',
        url: '/upgrade',
        tag: PREMIUM_EXPIRY_PUSH_TAG,
    };
}

export function canSendProductPush(lastSentAt, now = new Date()) {
    if (!lastSentAt) return true;
    const sentAt = new Date(lastSentAt).getTime();
    if (!Number.isFinite(sentAt)) return true;
    return now.getTime() - sentAt >= PRODUCT_PUSH_MIN_GAP_MS;
}

export function nextProductPushAt(lastSentAt) {
    if (!lastSentAt) return null;
    const sentAt = new Date(lastSentAt).getTime();
    if (!Number.isFinite(sentAt)) return null;
    return new Date(sentAt + PRODUCT_PUSH_MIN_GAP_MS);
}

/** In-app path, or an https link. Anything else is rejected. */
export function normalizeProductPushLink(raw) {
    const value = String(raw || '').trim();
    if (!value) return '/';
    if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) {
        return value.length <= 500 ? value : null;
    }
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:') return null;
        return url.toString();
    } catch {
        return null;
    }
}

export function buildPaymentPush({ amount, currency, invoiceNumber, invoiceId }) {
    const number = String(invoiceNumber || '').trim() || 'an invoice';
    const id = invoiceId ? String(invoiceId) : '';
    return {
        title: 'Payment received',
        body: `${formatPushMoney(amount, currency)} received on ${number}.`,
        url: id ? `/invoices/${id}` : '/invoices',
        tag: PAYMENT_PUSH_TAG,
    };
}
