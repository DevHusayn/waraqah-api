const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

export const PAYROLL_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function formatPayrollPeriod(year, month) {
    return `${year}-${String(month).padStart(2, '0')}`;
}

export function formatPayrollPeriodLabel(year, month) {
    return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function parsePayrollPeriodString(value) {
    const period = String(value || '').trim();
    if (!PAYROLL_PERIOD_PATTERN.test(period)) return null;
    const [year, month] = period.split('-').map(Number);
    return { year, month, period };
}

export function parsePayrollPeriodInput(source = {}) {
    const fromPeriod = parsePayrollPeriodString(source.period);
    if (fromPeriod) return fromPeriod;

    const year = Number.parseInt(source.year, 10);
    const month = Number.parseInt(source.month, 10);
    if (
        !Number.isInteger(year)
        || !Number.isInteger(month)
        || year < 1970
        || year > 2100
        || month < 1
        || month > 12
    ) {
        const err = new Error('Please choose a valid payroll month.');
        err.status = 400;
        throw err;
    }

    return { year, month, period: formatPayrollPeriod(year, month) };
}

export function buildPayrollExpenseDescription(role, year, month) {
    const label = formatPayrollPeriodLabel(year, month);
    const roleText = String(role || '').trim();
    return roleText ? `${roleText} · ${label}` : label;
}

export function isDuplicatePayrollKeyError(err) {
    return Boolean(err && err.code === 11000);
}

export function duplicatePayrollError() {
    const err = new Error('This staff member is already marked paid for that month.');
    err.status = 409;
    err.code = 'PAYROLL_ALREADY_PAID';
    return err;
}

export function staffHasPayrollExpensesError() {
    const err = new Error('This staff member has salary payments. Deactivate them instead of deleting.');
    err.status = 409;
    err.code = 'STAFF_HAS_PAYROLL';
    return err;
}

export function roundMoney(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 0;
    return Math.round(amount * 100) / 100;
}

export function selectPayrollStaff(staffList, paymentsByStaffId) {
    return staffList.filter((staff) => {
        if (staff.isActive !== false) return true;
        return paymentsByStaffId.has(String(staff._id || staff.id));
    });
}

export function buildPayrollRow(staff, payment) {
    const id = String(staff._id || staff.id);
    const paid = Boolean(payment);
    const salary = roundMoney(staff.salary);
    return {
        id,
        name: staff.name,
        role: staff.role,
        salary,
        isActive: staff.isActive !== false,
        paid,
        amount: paid ? roundMoney(payment.amount) : salary,
        expenseId: paid ? String(payment._id || payment.id) : null,
        paidDate: paid ? payment.date || null : null,
    };
}

export function buildPayrollTotals(rows) {
    let due = 0;
    let paid = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    let activeCount = 0;

    for (const row of rows) {
        due += Number(row.amount) || 0;
        if (row.paid) {
            paid += Number(row.amount) || 0;
            paidCount += 1;
        } else {
            unpaidCount += 1;
        }
        if (row.isActive) activeCount += 1;
    }

    due = roundMoney(due);
    paid = roundMoney(paid);

    return {
        due,
        paid,
        remaining: roundMoney(due - paid),
        activeCount,
        paidCount,
        unpaidCount,
    };
}

export function buildPayrollResponse({ year, month, staffList, payments }) {
    const paymentsByStaffId = new Map();
    for (const payment of payments) {
        if (payment?.staffId != null) {
            paymentsByStaffId.set(String(payment.staffId), payment);
        }
    }

    const rows = selectPayrollStaff(staffList, paymentsByStaffId)
        .map((staff) => buildPayrollRow(staff, paymentsByStaffId.get(String(staff._id || staff.id))))
        .sort((a, b) => {
            if (a.paid !== b.paid) return a.paid ? 1 : -1;
            return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
        });

    return {
        period: {
            year,
            month,
            label: formatPayrollPeriodLabel(year, month),
        },
        staff: rows,
        totals: buildPayrollTotals(rows),
    };
}
