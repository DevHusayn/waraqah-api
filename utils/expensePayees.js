export function normalizeVendorName(value) {
    return String(value || '').trim();
}

export function vendorMatchKey(value) {
    return normalizeVendorName(value).toLowerCase();
}

export function roundPayeeAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 0;
    return Math.round(amount * 100) / 100;
}

function compareDatesDesc(a, b) {
    return String(b || '').localeCompare(String(a || ''));
}

export function groupExpensesByPayee(expenses = []) {
    const groups = new Map();
    const unnamed = [];

    for (const expense of expenses) {
        const name = normalizeVendorName(expense.vendor);
        const id = String(expense._id || expense.id || '');
        if (!name) {
            unnamed.push({
                kind: 'expense',
                id,
                date: expense.date || '',
                amount: roundPayeeAmount(expense.amount),
                category: expense.category || '',
                description: expense.description || '',
                isRecurring: Boolean(expense.isRecurring),
            });
            continue;
        }

        const key = vendorMatchKey(name);
        let group = groups.get(key);
        if (!group) {
            group = {
                kind: 'payee',
                key,
                name,
                total: 0,
                count: 0,
                lastDate: expense.date || '',
                categories: new Map(),
                isRecurring: false,
            };
            groups.set(key, group);
        }

        const amount = Number(expense.amount) || 0;
        group.total += amount;
        group.count += 1;
        if ((expense.date || '') > (group.lastDate || '')) {
            group.lastDate = expense.date || '';
        }
        if (expense.isRecurring) group.isRecurring = true;
        const category = expense.category || 'other';
        group.categories.set(category, (group.categories.get(category) || 0) + amount);
    }

    const payees = [...groups.values()].map((group) => ({
        kind: 'payee',
        id: `payee:${group.key}`,
        key: group.key,
        name: group.name,
        total: roundPayeeAmount(group.total),
        count: group.count,
        lastDate: group.lastDate,
        isRecurring: group.isRecurring,
        categories: [...group.categories.entries()]
            .map(([category, amount]) => ({
                category,
                amount: roundPayeeAmount(amount),
            }))
            .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category)),
    }));

    return { payees, unnamed };
}

export function sortPayeeRows(rows, sort = 'newest') {
    const copy = [...rows];
    copy.sort((a, b) => {
        if (sort === 'recurring') {
            if (Boolean(a.isRecurring) !== Boolean(b.isRecurring)) {
                return a.isRecurring ? -1 : 1;
            }
            return compareDatesDesc(a.lastDate || a.date, b.lastDate || b.date);
        }

        const aAmount = a.kind === 'payee' ? a.total : a.amount;
        const bAmount = b.kind === 'payee' ? b.total : b.amount;
        const aDate = a.lastDate || a.date || '';
        const bDate = b.lastDate || b.date || '';

        if (sort === 'amountHigh' && aAmount !== bAmount) return bAmount - aAmount;
        if (sort === 'amountLow' && aAmount !== bAmount) return aAmount - bAmount;
        if (sort === 'oldest') return String(aDate).localeCompare(String(bDate));
        return compareDatesDesc(aDate, bDate);
    });
    return copy;
}

export function paginatePayeeRows(rows, page = 1, limit = 20) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.max(1, Number(limit) || 20);
    const start = (safePage - 1) * safeLimit;
    return {
        data: rows.slice(start, start + safeLimit),
        total: rows.length,
    };
}

export function buildPayeeList(expenses, { sort = 'newest', page = 1, limit = 20 } = {}) {
    const { payees, unnamed } = groupExpensesByPayee(expenses);
    const rows = sortPayeeRows([...payees, ...unnamed], sort);
    const { data, total } = paginatePayeeRows(rows, page, limit);
    return { data, total };
}

export function buildPayeeDetail(name, expenses = []) {
    const displayName = normalizeVendorName(expenses[0]?.vendor) || normalizeVendorName(name);
    const total = roundPayeeAmount(
        expenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0)
    );
    const categories = new Map();
    for (const expense of expenses) {
        const category = expense.category || 'other';
        categories.set(category, (categories.get(category) || 0) + (Number(expense.amount) || 0));
    }

    const lastDate = expenses.reduce((latest, expense) => {
        const date = expense.date || '';
        return date > latest ? date : latest;
    }, '');

    return {
        name: displayName,
        total,
        count: expenses.length,
        lastDate,
        categories: [...categories.entries()]
            .map(([category, amount]) => ({
                category,
                amount: roundPayeeAmount(amount),
            }))
            .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category)),
    };
}
