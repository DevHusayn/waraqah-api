import { sanitizeInvoicePayload } from './invoiceValidation.js';
import { getNextReceiptNumber } from './receiptNumber.js';
import { roundMoney, MONEY_EPS, sanitizePaymentPayload, getInvoiceBalanceDue, sumPayments, ensurePaymentLedger } from './invoicePayments.js';
import { syncDocumentBaseAmountPaid } from './documentCurrency.js';

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'pos', 'card', 'online_gateway'];
const DRAFT = 'draft';
const PAID = 'paid';
const RECEIPT_STATUSES = [DRAFT, PAID];

function validationError(message, status = 400) {
    const err = new Error(message);
    err.status = status;
    return err;
}

export function isReceiptDocument(doc) {
    return doc?.documentType === 'receipt';
}

export function isDraftStatus(status) {
    return status === DRAFT;
}

export function isFinalizingReceiptDraft(existing, payload) {
    return existing?.status === DRAFT && payload.status === PAID;
}

/** Block deletion of issued receipts. */
export function assertReceiptDeleteAllowed(existing) {
    if (!existing) return;
    const status = existing.status || DRAFT;
    if (status === PAID) {
        throw validationError('Issued receipts cannot be deleted.');
    }
}

/** Block edits on issued receipts. */
export function assertReceiptUpdateAllowed(existing, payload) {
    const prev = existing?.status || DRAFT;
    const next = payload.status ?? prev;

    if (prev === DRAFT) {
        if (next !== DRAFT && next !== PAID) {
            throw validationError('Receipts can only be saved as draft or issued (paid).');
        }
        return;
    }

    if (prev === PAID) {
        throw validationError('Issued receipts cannot be modified.');
    }
}

export function normalizeReceiptPayload(body, { isCreate = false, existing = null } = {}) {
    const data = sanitizeInvoicePayload(body);
    let status = data.status || (isCreate ? DRAFT : PAID);

    if (isCreate) {
        status = data.status === DRAFT ? DRAFT : PAID;
        data.status = status;
        if (status === DRAFT) {
            delete data.paymentMethod;
            delete data.datePaid;
        }
    }

    if (!isCreate && existing) {
        assertReceiptUpdateAllowed(existing, data);
        status = data.status ?? existing.status ?? DRAFT;
        data.status = status;
    }

    if (status !== DRAFT && status !== PAID) {
        throw validationError('Receipts can only be saved as draft or issued (paid).');
    }

    // Standalone receipts do not use due dates or recurring fields.
    delete data.dueDate;
    data.isRecurring = false;
    delete data.recurringFrequency;
    delete data.recurringEndDate;

    if (status === DRAFT) {
        delete data.paymentMethod;
        delete data.receiptNumber;
        delete data.datePaid;
        delete data.invoiceNumber;
        if (!data.clientId) {
            data.clientId = null;
        }
    } else if (status === PAID) {
        if (!data.paymentMethod || !PAYMENT_METHODS.includes(data.paymentMethod)) {
            throw validationError(
                'Payment method is required to issue a receipt (cash, bank_transfer, pos, card, or online_gateway).'
            );
        }
        if (!data.datePaid) {
            data.datePaid = new Date().toISOString().slice(0, 10);
        }
    }

    data.documentType = 'receipt';
    data.status = status;
    return data;
}

/** Assign receipt number for issued receipts; never assign invoice number. */
export async function assignReceiptNumbers(payload, existing, userId, generators = {}) {
    const { getNextReceiptNumber: nextReceipt = getNextReceiptNumber } = generators;
    const status = payload.status || DRAFT;
    const result = { ...payload, documentType: 'receipt' };

    delete result.invoiceNumber;

    if (status === DRAFT) {
        delete result.receiptNumber;
        return result;
    }

    result.receiptNumber =
        existing?.receiptNumber || (await nextReceipt(userId));
    return result;
}

/** Populate payment ledger when a receipt is issued. */
export function applyReceiptPaymentLedger(doc, { amount } = {}) {
    if (!doc || doc.status !== PAID) return doc;

    const total = roundMoney(doc.total);
    let paidAmount =
        amount !== undefined && amount !== null && amount !== ''
            ? roundMoney(amount)
            : total;

    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
        throw validationError('Payment amount must be greater than zero.');
    }
    if (paidAmount > total + MONEY_EPS) {
        throw validationError(`Payment amount cannot exceed the total (${total.toFixed(2)}).`);
    }
    if (paidAmount > total) {
        paidAmount = total;
    }

    doc.payments = [
        {
            amount: paidAmount,
            method: doc.paymentMethod,
            date: doc.datePaid,
            note: '',
            createdAt: new Date(),
        },
    ];
    doc.amountPaid = paidAmount;
    syncDocumentBaseAmountPaid(doc);
    return doc;
}

function parseReceiptMoney(raw) {
    if (typeof raw === 'number') return roundMoney(raw);
    return roundMoney(String(raw).replace(/,/g, '').trim());
}

export function resolveReceiptPaymentAmount(body, docTotal) {
    if (body?.paidInFull === false || body?.paidInFull === 'false') {
        const raw = body.paymentAmount ?? body.amountPaid;
        if (raw === undefined || raw === null || raw === '') {
            throw validationError('Enter the amount received.');
        }
        return parseReceiptMoney(raw);
    }
    return roundMoney(docTotal);
}

/**
 * Append an installment to a standalone receipt (mutates in-memory fields; caller saves).
 * Issued receipts keep status `paid`; partial vs fully paid is derived from amountPaid vs total.
 */
export function applyReceiptPayment(receipt, paymentInput) {
    if (!isReceiptDocument(receipt)) {
        throw validationError('Receipt not found.');
    }
    if (receipt.status !== PAID) {
        throw validationError('Payments can only be recorded on issued receipts.');
    }

    ensurePaymentLedger(receipt);

    const balanceDue = getInvoiceBalanceDue(receipt);
    if (balanceDue <= MONEY_EPS) {
        throw validationError('This receipt is already fully paid.');
    }

    const payment = {
        ...sanitizePaymentPayload(paymentInput),
        createdAt: new Date(),
    };

    if (payment.amount > balanceDue + MONEY_EPS) {
        throw validationError(
            `Payment amount exceeds the balance due (${balanceDue.toFixed(2)}).`
        );
    }
    if (payment.amount > balanceDue) {
        payment.amount = balanceDue;
    }

    const payments = [...(receipt.payments || []), payment];
    const amountPaid = sumPayments(payments);
    const total = roundMoney(receipt.total);

    receipt.payments = payments;
    receipt.amountPaid = amountPaid;
    receipt.paymentMethod = payment.method;
    receipt.datePaid = payment.date;
    receipt.status = PAID;
    syncDocumentBaseAmountPaid(receipt);

    return {
        becameFullyPaid: amountPaid + MONEY_EPS >= total && total >= 0,
        payment,
        balanceDue: getInvoiceBalanceDue(receipt),
        amountPaid,
    };
}

/** Standalone receipt with amount received below line-item total (in-memory check). */
export function isPartialReceiptDoc(doc) {
    if (!isReceiptDocument(doc)) return false;
    if (doc.status === 'draft' || doc.status === 'cancelled') return false;
    const total = roundMoney(doc?.total);
    if (total <= 0) return false;
    const paid = roundMoney(doc?.amountPaid ?? 0);
    if (paid <= MONEY_EPS) return false;
    return getInvoiceBalanceDue(doc) > MONEY_EPS;
}

/** Mongo filter: standalone receipt with amount received below line-item total. */
export function buildReceiptPartialFilter() {
    return {
        $expr: {
            $and: [
                { $gt: [{ $ifNull: ['$amountPaid', 0] }, MONEY_EPS] },
                {
                    $gt: [
                        {
                            $subtract: [
                                { $ifNull: ['$total', 0] },
                                { $ifNull: ['$amountPaid', 0] },
                            ],
                        },
                        MONEY_EPS,
                    ],
                },
            ],
        },
    };
}

/** Mongo filter: issued receipt fully settled (matches UI "Fully received"). */
export function buildReceiptFullFilter() {
    return {
        $expr: {
            $or: [
                {
                    $gte: [
                        { $ifNull: ['$amountPaid', 0] },
                        {
                            $subtract: [
                                { $ifNull: ['$total', 0] },
                                MONEY_EPS,
                            ],
                        },
                    ],
                },
                {
                    $and: [
                        { $lte: [{ $ifNull: ['$amountPaid', 0] }, MONEY_EPS] },
                        { $gt: [{ $ifNull: ['$total', 0] }, 0] },
                    ],
                },
            ],
        },
    };
}
