import { getNextInvoiceNumber, receiptFromInvoiceNumber } from './invoiceNumber.js';

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'pos', 'card', 'online_gateway'];
const PAID = 'paid';
const CANCELLED = 'cancelled';
const CANCELLABLE = ['pending', 'overdue'];

function validationError(message, status = 400) {
    const err = new Error(message);
    err.status = status;
    return err;
}

/** Block illegal status transitions and edits on terminal invoices. */
export function assertInvoiceUpdateAllowed(existing, payload) {
    const prev = existing.status || 'pending';
    const next = payload.status ?? prev;

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
    const data = { ...body };
    let status = data.status || 'pending';

    if (isCreate) {
        status = 'pending';
        data.status = 'pending';
        delete data.paymentMethod;
        delete data.receiptNumber;
        delete data.datePaid;
    }

    if (!isCreate && existing) {
        assertInvoiceUpdateAllowed(existing, data);
        status = data.status ?? existing.status ?? 'pending';
        data.status = status;
    }

    if (status === PAID) {
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
