/**
 * Shared formatting helpers for transactional email content.
 */

export function formatCurrency(amount, currency = 'NGN') {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) return String(amount ?? '');

    try {
        return new Intl.NumberFormat('en-NG', {
            style: 'currency',
            currency: currency || 'NGN',
            minimumFractionDigits: 2,
        }).format(numericAmount);
    } catch {
        return `${currency || 'NGN'} ${numericAmount.toFixed(2)}`;
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
