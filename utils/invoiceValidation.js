import { getNextInvoiceNumber, receiptFromInvoiceNumber } from './invoiceNumber.js';
import { isValidObjectId, sanitizeNumber, sanitizePlainText } from './sanitize.js';

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'pos', 'card', 'online_gateway'];
const PAID = 'paid';
const CANCELLED = 'cancelled';
const DRAFT = 'draft';
const CANCELLABLE = ['pending', 'overdue'];
const STATUSES = ['draft', 'pending', 'paid', 'overdue', 'cancelled'];
const RECURRING_FREQUENCIES = ['weekly', 'bi-weekly', 'monthly', 'quarterly', 'yearly'];
const MAX_ITEMS = 100;
const ALLOWED_INVOICE_FIELDS = [
    'clientId',
    'date',
    'dueDate',
    'items',
    'notes',
    'status',
    'paymentMethod',
    'datePaid',
    'currency',
    'taxRate',
    'discountType',
    'discountValue',
    'discount',
    'subtotal',
    'tax',
    'total',
    'isRecurring',
    'recurringFrequency',
    'recurringEndDate',
];

function validationError(message, status = 400) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function sanitizeInvoiceItem(item) {
    if (!item || typeof item !== 'object') {
        throw validationError('Invalid invoice line item.');
    }
    return {
        description: sanitizePlainText(item.description, 500),
        quantity: sanitizeNumber(item.quantity, { min: 0, max: 1_000_000, fallback: 0 }),
        rate: sanitizeNumber(item.rate, { min: 0, max: 1_000_000_000, fallback: 0 }),
    };
}

export function sanitizeInvoicePayload(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw validationError('Invalid invoice payload.');
    }

    const data = {};
    for (const key of ALLOWED_INVOICE_FIELDS) {
        if (body[key] !== undefined) {
            data[key] = body[key];
        }
    }

    if (data.clientId !== undefined && data.clientId !== null && data.clientId !== '') {
        if (!isValidObjectId(String(data.clientId))) {
            throw validationError('Invalid client ID.');
        }
        data.clientId = String(data.clientId);
    }

    if (data.status !== undefined && !STATUSES.includes(data.status)) {
        throw validationError('Invalid invoice status.');
    }

    if (data.paymentMethod !== undefined && !PAYMENT_METHODS.includes(data.paymentMethod)) {
        delete data.paymentMethod;
    }

    if (data.discountType !== undefined && !['fixed', 'percent'].includes(data.discountType)) {
        data.discountType = 'fixed';
    }

    if (data.recurringFrequency !== undefined && !RECURRING_FREQUENCIES.includes(data.recurringFrequency)) {
        delete data.recurringFrequency;
    }

    if (Array.isArray(data.items)) {
        if (data.items.length > MAX_ITEMS) {
            throw validationError(`Invoices cannot have more than ${MAX_ITEMS} line items.`);
        }
        data.items = data.items.map(sanitizeInvoiceItem);
    }

    data.notes = data.notes !== undefined ? sanitizePlainText(data.notes, 2000) : undefined;
    data.date = data.date !== undefined ? sanitizePlainText(data.date, 32) : undefined;
    data.dueDate = data.dueDate !== undefined ? sanitizePlainText(data.dueDate, 32) : undefined;
    data.datePaid = data.datePaid !== undefined ? sanitizePlainText(data.datePaid, 32) : undefined;
    data.recurringEndDate =
        data.recurringEndDate !== undefined ? sanitizePlainText(data.recurringEndDate, 32) : undefined;
    data.currency = data.currency !== undefined ? sanitizePlainText(data.currency, 8) : undefined;

    if (data.taxRate !== undefined) {
        data.taxRate = sanitizeNumber(data.taxRate, { min: 0, max: 100, fallback: 0 });
    }
    if (data.discountValue !== undefined) {
        data.discountValue = sanitizeNumber(data.discountValue, { min: 0, max: 1_000_000_000, fallback: 0 });
    }
    if (data.discount !== undefined) {
        data.discount = sanitizeNumber(data.discount, { min: 0, max: 1_000_000_000, fallback: 0 });
    }
    if (data.subtotal !== undefined) {
        data.subtotal = sanitizeNumber(data.subtotal, { min: 0, max: 1_000_000_000, fallback: 0 });
    }
    if (data.tax !== undefined) {
        data.tax = sanitizeNumber(data.tax, { min: 0, max: 1_000_000_000, fallback: 0 });
    }
    if (data.total !== undefined) {
        data.total = sanitizeNumber(data.total, { min: 0, max: 1_000_000_000, fallback: 0 });
    }
    if (data.isRecurring !== undefined) {
        data.isRecurring = Boolean(data.isRecurring);
    }

    // Recurring invoices disabled until automation is supported in production.
    data.isRecurring = false;
    delete data.recurringFrequency;
    delete data.recurringEndDate;

    return data;
}

export function isDraftStatus(status) {
    return status === DRAFT;
}

/** Block illegal status transitions and edits on terminal invoices. */
export function assertInvoiceUpdateAllowed(existing, payload) {
    const prev = existing.status || 'pending';
    const next = payload.status ?? prev;

    if (prev === DRAFT) {
        return;
    }

    if (prev === PAID) {
        throw validationError('Paid invoices cannot be modified.');
    }

    if (prev === CANCELLED) {
        throw validationError('Cancelled invoices cannot be edited or marked as paid.');
    }

    if (next === PAID && prev === CANCELLED) {
        throw validationError('Cancelled invoices cannot be marked as paid.');
    }

    if (next === CANCELLED && !CANCELLABLE.includes(prev)) {
        throw validationError('Only pending or overdue invoices can be cancelled.');
    }
}

export function normalizeInvoicePayload(body, { isCreate = false, existing = null } = {}) {
    const data = sanitizeInvoicePayload(body);
    let status = data.status || (isCreate ? DRAFT : 'pending');

    if (isCreate) {
        status = data.status === DRAFT ? DRAFT : 'pending';
        data.status = status;
        delete data.paymentMethod;
        delete data.receiptNumber;
        delete data.datePaid;
        if (status === DRAFT) {
            delete data.invoiceNumber;
            delete data.receiptNumber;
        }
    }

    if (!isCreate && existing) {
        assertInvoiceUpdateAllowed(existing, data);
        status = data.status ?? existing.status ?? 'pending';
        data.status = status;
    }

    if (status === DRAFT) {
        delete data.paymentMethod;
        delete data.receiptNumber;
        delete data.datePaid;
        delete data.invoiceNumber;
        delete data.receiptNumber;
        if (!data.clientId) {
            data.clientId = null;
        }
    } else if (status === PAID) {
        if (!data.paymentMethod || !PAYMENT_METHODS.includes(data.paymentMethod)) {
            const err = new Error(
                'Payment method is required for paid invoices (cash, bank_transfer, pos, card, or online_gateway).'
            );
            err.status = 400;
            throw err;
        }
        if (!data.datePaid) {
            data.datePaid = new Date().toISOString();
        }
    } else {
        delete data.paymentMethod;
        delete data.receiptNumber;
        delete data.datePaid;
    }

    data.status = status;
    return data;
}

/**
 * Assign invoice/receipt numbers based on status and existing record.
 */
export async function assignDocumentNumbers(payload, existing, userId, generators) {
    const { getNextInvoiceNumber } = generators;
    const status = payload.status || 'pending';
    const result = { ...payload };

    if (status === DRAFT) {
        delete result.invoiceNumber;
        delete result.receiptNumber;
        return result;
    }

    if (status === PAID) {
        const invNum = existing?.invoiceNumber ?? payload.invoiceNumber;
        result.invoiceNumber = invNum ?? null;
        result.receiptNumber =
            existing?.receiptNumber || receiptFromInvoiceNumber(invNum);
    } else {
        result.invoiceNumber =
            existing?.invoiceNumber || (await getNextInvoiceNumber(userId));
        delete result.receiptNumber;
    }

    return result;
}

export function isFinalizingDraft(existing, payload) {
    return existing?.status === DRAFT && payload.status === 'pending';
}
