import { getNextInvoiceNumber, receiptFromInvoiceNumber } from './invoiceNumber.js';
import { isValidObjectId, sanitizeNumber, sanitizePlainText } from './sanitize.js';
import { getInvoiceAmountPaid } from './invoicePayments.js';
import { INVOICE_ONLY_FILTER } from './invoiceDocumentFilter.js';
import { applyRecurringSchedule, sanitizeRecurringEndDate } from './recurrence.js';
import { isValidCurrencyCode } from './locale.js';

export { INVOICE_ONLY_FILTER };

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'pos', 'card', 'online_gateway'];
const PAID = 'paid';
const CANCELLED = 'cancelled';
const DRAFT = 'draft';
const PARTIAL = 'partial';
const CANCELLABLE = ['pending', 'partial', 'overdue'];
const STATUSES = ['draft', 'pending', 'partial', 'paid', 'overdue', 'cancelled'];
const RECURRING_FREQUENCIES = ['weekly', 'bi-weekly', 'monthly', 'quarterly', 'yearly'];
const MAX_ITEMS = 100;
const TOTAL_FIELDS = [
    'items',
    'subtotal',
    'tax',
    'total',
    'taxRate',
    'discount',
    'discountValue',
    'discountType',
    'currency',
    'exchangeRate',
];
const ALLOWED_INVOICE_FIELDS = [
    'clientId',
    'clientName',
    'clientCompany',
    'date',
    'dueDate',
    'items',
    'notes',
    'documentFooter',
    'clientAdditionalInfo',
    'status',
    'paymentMethod',
    'datePaid',
    'currency',
    'exchangeRate',
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

function sanitizeItemProductId(productId) {
    if (productId === undefined || productId === null || productId === '') {
        return null;
    }
    if (!isValidObjectId(String(productId))) {
        throw validationError('Invalid product ID on line item.');
    }
    return String(productId);
}

function sanitizeInvoiceItem(item) {
    if (!item || typeof item !== 'object') {
        throw validationError('Invalid invoice line item.');
    }
    const unit = sanitizePlainText(item.unit, 40) || 'Qty';
    return {
        description: sanitizePlainText(item.description, 500),
        quantity: sanitizeNumber(item.quantity, { min: 0, max: 1_000_000, fallback: 0 }),
        rate: sanitizeNumber(item.rate, { min: 0, max: 1_000_000_000, fallback: 0 }),
        unit,
        productId: sanitizeItemProductId(item.productId),
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

    if (data.clientName !== undefined) {
        data.clientName = sanitizePlainText(data.clientName, 200) || null;
    }
    if (data.clientCompany !== undefined) {
        data.clientCompany = sanitizePlainText(data.clientCompany, 200) || null;
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
    data.documentFooter =
        data.documentFooter !== undefined ? sanitizePlainText(data.documentFooter, 500) : undefined;
    data.clientAdditionalInfo =
        data.clientAdditionalInfo !== undefined
            ? sanitizePlainText(data.clientAdditionalInfo, 500)
            : undefined;
    data.date = data.date !== undefined ? sanitizePlainText(data.date, 32) : undefined;
    data.dueDate =
        data.dueDate !== undefined
            ? data.dueDate === null || data.dueDate === ''
                ? null
                : sanitizePlainText(data.dueDate, 32)
            : undefined;
    data.datePaid = data.datePaid !== undefined ? sanitizePlainText(data.datePaid, 32) : undefined;
    data.recurringEndDate =
        data.recurringEndDate !== undefined ? sanitizeRecurringEndDate(data.recurringEndDate) : undefined;
    data.currency =
        data.currency !== undefined
            ? (() => {
                  const code = sanitizePlainText(data.currency, 8).toUpperCase();
                  if (!isValidCurrencyCode(code)) {
                      throw validationError('Please choose a valid currency.');
                  }
                  return code;
              })()
            : undefined;
    if (data.exchangeRate !== undefined && data.exchangeRate !== null && data.exchangeRate !== '') {
        data.exchangeRate = sanitizeNumber(data.exchangeRate, {
            min: 0,
            max: 1_000_000_000,
            fallback: NaN,
        });
    }

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

    return data;
}

export function isDraftStatus(status) {
    return status === DRAFT;
}

function totalsMeaningfullyChanged(existing, payload) {
    for (const field of TOTAL_FIELDS) {
        if (payload[field] === undefined) continue;
        if (field === 'items') {
            const prevItems = JSON.stringify(existing.items || []);
            const nextItems = JSON.stringify(payload.items || []);
            if (prevItems !== nextItems) return true;
            continue;
        }
        if (field === 'discountType') {
            if (String(payload[field] || '') !== String(existing[field] || '')) return true;
            continue;
        }
        if (Number(payload[field]) !== Number(existing[field] ?? 0)) return true;
    }
    return false;
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
        throw validationError('Only pending, partial, or overdue invoices can be cancelled.');
    }

    // Status transitions to partial should go through POST /payments.
    if (next === PARTIAL && prev !== PARTIAL) {
        throw validationError('Record a payment to mark an invoice as partially paid.');
    }

    const amountPaid = getInvoiceAmountPaid(existing);
    if (amountPaid > 0 && totalsMeaningfullyChanged(existing, payload)) {
        throw validationError(
            'Invoices with recorded payments cannot change amounts or line items.'
        );
    }
}

/** Block deletion of terminal invoices kept for records. */
export function assertInvoiceDeleteAllowed(existing) {
    const status = existing.status || 'pending';

    if (status === PAID) {
        throw validationError('Paid invoices cannot be deleted.');
    }

    if (status === CANCELLED) {
        throw validationError('Cancelled invoices cannot be deleted.');
    }

    if (getInvoiceAmountPaid(existing) > 0) {
        throw validationError('Invoices with recorded payments cannot be deleted.');
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
        // Payment ledger fields are owned by POST /payments (or mark-paid sync).
        delete data.paymentMethod;
        delete data.receiptNumber;
        delete data.datePaid;
    }

    data.status = status;
    data.documentType = 'invoice';
    applyRecurringSchedule(data, { existing });
    return data;
}

export async function assignDocumentNumbers(payload, existing, userId, generators) {
    const { getNextInvoiceNumber } = generators;
    const status = payload.status || 'pending';
    const result = { ...payload };

    if (payload.documentType === 'receipt') {
        throw validationError('Use the receipts API for standalone receipts.');
    }

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

/** Remove custom document footer for non-premium users. */
export function stripPremiumDocumentFooter(data, premium) {
    if (!data || premium) return data;
    delete data.documentFooter;
    return data;
}
