import mongoose from 'mongoose';
import {
    applyRecurringSchedule,
    isRecurringFrequency,
    sanitizeRecurringEndDate,
} from './recurrence.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function isValidObjectId(id) {
    return typeof id === 'string' && mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id;
}

export function sanitizePlainText(value, maxLen = 500) {
    if (value === undefined || value === null) return '';
    const str = String(value).replace(CONTROL_CHARS, '').trim();
    if (str.length > maxLen) {
        return str.slice(0, maxLen);
    }
    return str;
}

export function sanitizeEmail(value) {
    const normalized = sanitizePlainText(value, 254).toLowerCase();
    if (!normalized) return '';
    if (!EMAIL_PATTERN.test(normalized)) {
        const err = new Error('Please enter a valid email address.');
        err.status = 400;
        throw err;
    }
    return normalized;
}

export function sanitizeOptionalEmail(value) {
    const normalized = sanitizePlainText(value, 254).toLowerCase();
    if (!normalized) return '';
    if (!EMAIL_PATTERN.test(normalized)) {
        const err = new Error('Please enter a valid email address.');
        err.status = 400;
        throw err;
    }
    return normalized;
}

export function sanitizeHexColor(value, fallback = '#16A34A') {
    const color = sanitizePlainText(value, 7);
    if (!color) return fallback;
    if (!HEX_COLOR_PATTERN.test(color)) {
        const err = new Error('Please enter a valid color code (e.g. #16A34A).');
        err.status = 400;
        throw err;
    }
    return color;
}

export function sanitizeNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
}

export function sanitizeDataUrl(value, { maxBytes = 500 * 1024, allowedPrefixes = [] } = {}) {
    if (value === undefined || value === null || value === '') return '';
    const str = String(value);
    if (!allowedPrefixes.some((prefix) => str.startsWith(prefix))) {
        const err = new Error('Invalid image format.');
        err.status = 400;
        throw err;
    }
    const base64Part = str.split(',')[1] || '';
    const approxBytes = Math.ceil((base64Part.length * 3) / 4);
    if (approxBytes > maxBytes) {
        const err = new Error('Image is too large.');
        err.status = 400;
        throw err;
    }
    return str;
}

export function pickFields(source, fields) {
    const result = {};
    for (const field of fields) {
        if (source[field] !== undefined) {
            result[field] = source[field];
        }
    }
    return result;
}

export function sanitizeClientPayload(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        const err = new Error('Invalid client payload.');
        err.status = 400;
        throw err;
    }

    const name = sanitizePlainText(body.name, 200);
    if (!name) {
        const err = new Error('Client name is required.');
        err.status = 400;
        throw err;
    }

    return {
        name,
        company: sanitizePlainText(body.company ?? body.business, 200),
        email: body.email ? sanitizeOptionalEmail(body.email) : '',
        phone: sanitizePlainText(body.phone, 50),
        address: sanitizePlainText(body.address, 500),
    };
}

export function sanitizeClientUpdates(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        const err = new Error('Invalid client payload.');
        err.status = 400;
        throw err;
    }

    const updates = {};
    if (body.name !== undefined) {
        const name = sanitizePlainText(body.name, 200);
        if (!name) {
            const err = new Error('Client name is required.');
            err.status = 400;
            throw err;
        }
        updates.name = name;
    }
    if (body.company !== undefined || body.business !== undefined) {
        updates.company = sanitizePlainText(body.company ?? body.business, 200);
    }
    if (body.email !== undefined) {
        updates.email = body.email ? sanitizeOptionalEmail(body.email) : '';
    }
    if (body.phone !== undefined) {
        updates.phone = sanitizePlainText(body.phone, 50);
    }
    if (body.address !== undefined) {
        updates.address = sanitizePlainText(body.address, 500);
    }
    return updates;
}

export function sanitizeSupplierPayload(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        const err = new Error('Invalid supplier payload.');
        err.status = 400;
        throw err;
    }

    const name = sanitizePlainText(body.name, 200);
    if (!name) {
        const err = new Error('Supplier name is required.');
        err.status = 400;
        throw err;
    }

    return {
        name,
        company: sanitizePlainText(body.company ?? body.business, 200),
        email: body.email ? sanitizeOptionalEmail(body.email) : '',
        phone: sanitizePlainText(body.phone, 50),
        address: sanitizePlainText(body.address, 500),
    };
}

export function sanitizeSupplierUpdates(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        const err = new Error('Invalid supplier payload.');
        err.status = 400;
        throw err;
    }

    const updates = {};
    if (body.name !== undefined) {
        const name = sanitizePlainText(body.name, 200);
        if (!name) {
            const err = new Error('Supplier name is required.');
            err.status = 400;
            throw err;
        }
        updates.name = name;
    }
    if (body.company !== undefined || body.business !== undefined) {
        updates.company = sanitizePlainText(body.company ?? body.business, 200);
    }
    if (body.email !== undefined) {
        updates.email = body.email ? sanitizeOptionalEmail(body.email) : '';
    }
    if (body.phone !== undefined) {
        updates.phone = sanitizePlainText(body.phone, 50);
    }
    if (body.address !== undefined) {
        updates.address = sanitizePlainText(body.address, 500);
    }
    return updates;
}

export function sanitizeStaffSalary(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) {
        const err = new Error('Salary must be greater than zero.');
        err.status = 400;
        throw err;
    }
    return Math.round(amount * 100) / 100;
}

export function sanitizeStaffPayload(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        const err = new Error('Invalid staff payload.');
        err.status = 400;
        throw err;
    }

    const name = sanitizePlainText(body.name, 200);
    if (!name) {
        const err = new Error('Staff name is required.');
        err.status = 400;
        throw err;
    }

    const role = sanitizePlainText(body.role, 80);
    if (!role) {
        const err = new Error('Staff role is required.');
        err.status = 400;
        throw err;
    }

    return {
        name,
        role,
        salary: sanitizeStaffSalary(body.salary),
        isActive: body.isActive === undefined ? true : Boolean(body.isActive),
    };
}

export function sanitizeStaffUpdates(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        const err = new Error('Invalid staff payload.');
        err.status = 400;
        throw err;
    }

    const updates = {};
    if (body.name !== undefined) {
        const name = sanitizePlainText(body.name, 200);
        if (!name) {
            const err = new Error('Staff name is required.');
            err.status = 400;
            throw err;
        }
        updates.name = name;
    }
    if (body.role !== undefined) {
        const role = sanitizePlainText(body.role, 80);
        if (!role) {
            const err = new Error('Staff role is required.');
            err.status = 400;
            throw err;
        }
        updates.role = role;
    }
    if (body.salary !== undefined) {
        updates.salary = sanitizeStaffSalary(body.salary);
    }
    if (body.isActive !== undefined) {
        updates.isActive = Boolean(body.isActive);
    }
    return updates;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function sanitizeExpenseDate(value) {
    const date = sanitizePlainText(value, 10);
    if (!ISO_DATE_PATTERN.test(date)) {
        const err = new Error('Please enter a valid expense date.');
        err.status = 400;
        throw err;
    }
    const parsed = new Date(`${date}T12:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
        const err = new Error('Please enter a valid expense date.');
        err.status = 400;
        throw err;
    }
    return date;
}

export function sanitizeExpenseAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) {
        const err = new Error('Expense amount must be greater than zero.');
        err.status = 400;
        throw err;
    }
    return Math.round(amount * 100) / 100;
}

function sanitizeExpenseCategoryValue(value) {
    const category = sanitizePlainText(value, 50);
    if (!category) {
        const err = new Error('Please enter an expense category.');
        err.status = 400;
        throw err;
    }
    return category;
}

function sanitizeExpenseRecurringFields(body, existing = null, date = null) {
    const data = {};
    if (date) data.date = date;
    if (body.isRecurring !== undefined) {
        data.isRecurring = Boolean(body.isRecurring);
    }
    if (body.recurringFrequency !== undefined) {
        data.recurringFrequency = isRecurringFrequency(body.recurringFrequency)
            ? body.recurringFrequency
            : undefined;
    }
    if (body.recurringEndDate !== undefined) {
        data.recurringEndDate = sanitizeRecurringEndDate(body.recurringEndDate);
    }

    const touchesRecurring =
        body.isRecurring !== undefined
        || body.recurringFrequency !== undefined
        || body.recurringEndDate !== undefined
        || Boolean(existing?.isRecurring && date && existing.date && date !== existing.date);

    if (!touchesRecurring) return data;

    applyRecurringSchedule(data, { existing });
    return data;
}

export function sanitizeExpensePayload(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        const err = new Error('Invalid expense payload.');
        err.status = 400;
        throw err;
    }

    const date = sanitizeExpenseDate(body.date);
    const data = {
        date,
        amount: sanitizeExpenseAmount(body.amount),
        category: sanitizeExpenseCategoryValue(body.category),
        description: sanitizePlainText(body.description, 500),
        vendor: sanitizePlainText(body.vendor, 200),
        ...sanitizeExpenseRecurringFields(body, null, date),
    };
    return data;
}

export function sanitizeExpenseUpdates(body, existing = null) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        const err = new Error('Invalid expense payload.');
        err.status = 400;
        throw err;
    }

    const updates = {};
    if (body.date !== undefined) {
        updates.date = sanitizeExpenseDate(body.date);
    }
    if (body.amount !== undefined) {
        updates.amount = sanitizeExpenseAmount(body.amount);
    }
    if (body.category !== undefined) {
        updates.category = sanitizeExpenseCategoryValue(body.category);
    }
    if (body.description !== undefined) {
        updates.description = sanitizePlainText(body.description, 500);
    }
    if (body.vendor !== undefined) {
        updates.vendor = sanitizePlainText(body.vendor, 200);
    }
    const date = updates.date || existing?.date || null;
    Object.assign(updates, sanitizeExpenseRecurringFields(body, existing, date));
    return updates;
}
