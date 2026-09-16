/**
 * Shared formatting helpers for transactional email content.
 */

export function formatCurrency(amount, currency = 'NGN') {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) return String(amount ?? '');
    const code = String(currency || 'NGN').trim().toUpperCase() || 'NGN';

    try {
        return new Intl.NumberFormat('en', {
            style: 'currency',
            currency: code,
            currencyDisplay: 'narrowSymbol',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        }).format(numericAmount);
    } catch {
        try {
            return new Intl.NumberFormat('en', {
                style: 'currency',
                currency: code,
                currencyDisplay: 'narrowSymbol',
                minimumFractionDigits: 0,
            }).format(numericAmount);
        } catch {
            const formatted = numericAmount.toLocaleString('en', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
            });
            return `${code} ${formatted}`;
        }
    }
}

export function formatDate(value) {
    if (!value) return '—';

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return new Intl.DateTimeFormat('en-NG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    }).format(date);
}

export function formatDaysUntilDue(daysUntilDue) {
    const days = Number(daysUntilDue);
    if (!Number.isFinite(days)) return 'soon';

    if (days <= 0) return 'today';
    if (days === 1) return '1 day';
    return `${days} days`;
}
