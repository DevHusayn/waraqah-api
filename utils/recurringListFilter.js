export function isRecurringListQuery(value) {
    const recurring = String(value || '').trim().toLowerCase();
    return recurring === '1' || recurring === 'true';
}

/**
 * Recurring is a series view (active templates), not "dated in this period".
 * Period dates still apply to the normal list.
 */
export function applyListRecurringAndDateFilter(filter, { recurring, dateFilter } = {}) {
    if (isRecurringListQuery(recurring)) {
        filter.isRecurring = true;
        return filter;
    }
    if (dateFilter) Object.assign(filter, dateFilter);
    return filter;
}

/** Include invoices generated from active templates in a recurring list filter. */
export function includeRecurringChildren(filter, templateIds) {
    if (!filter || filter.isRecurring !== true) return filter;
    const ids = (templateIds || []).filter(Boolean);
    if (!ids.length) return filter;

    delete filter.isRecurring;
    const series = {
        $or: [
            { isRecurring: true },
            { recurringSourceId: { $in: ids } },
        ],
    };
    if (filter.$or) {
        filter.$and = [...(filter.$and || []), { $or: filter.$or }, series];
        delete filter.$or;
    } else {
        Object.assign(filter, series);
    }
    return filter;
}
