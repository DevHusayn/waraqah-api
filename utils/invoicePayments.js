import { sanitizeNumber, sanitizePlainText } from './sanitize.js';
import { todayDateString } from './invoiceOverdue.js';

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'pos', 'card', 'online_gateway'];
const PAYABLE_STATUSES = ['pending', 'partial', 'overdue'];
const MONEY_EPS = 0.009;

function validationError(message, status = 400) {
    const err = new Error(message);
    err.status = status;
    return err;
}

export function roundMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
}

export function getInvoiceAmountPaid(invoice) {
    if (!invoice) return 0;
    const recorded = roundMoney(invoice.amountPaid);
    if (recorded > 0) return recorded;
    if (invoice.status === 'paid') {
        return roundMoney(invoice.total);
    }
    if (Array.isArray(invoice.payments) && invoice.payments.length > 0) {
        return sumPayments(invoice.payments);
    }
    return 0;
}

export function getInvoiceBalanceDue(invoice) {
    const total = roundMoney(invoice?.total);
    return Math.max(0, roundMoney(total - getInvoiceAmountPaid(invoice)));
}

export function isInvoicePastDue(invoice, today = todayDateString()) {
    const due = invoice?.dueDate;
    if (!due || typeof due !== 'string') return false;
    return due < today;
}

/**
 * Resolve invoice status after a payment (or when recomputing).
 * Fully paid always wins; otherwise overdue if past due, else partial/pending.
 */
export function resolvePaymentStatus(invoice, { amountPaid, today = todayDateString() } = {}) {
    const total = roundMoney(invoice?.total);
    const paid = roundMoney(amountPaid ?? getInvoiceAmountPaid(invoice));

    if (paid + MONEY_EPS >= total && total >= 0) {
        return 'paid';
    }
    if (isInvoicePastDue({ dueDate: invoice?.dueDate }, today)) {
        return 'overdue';
    }
    if (paid > MONEY_EPS) {
        return 'partial';
    }
    return 'pending';
}

export function sumPayments(payments) {
    if (!Array.isArray(payments)) return 0;
    return roundMoney(payments.reduce((sum, p) => sum + (Number(p?.amount) || 0), 0));
}

/** Lazy-migrate legacy paid invoices that lack a payments ledger. */
export function ensurePaymentLedger(invoice) {
    if (!invoice) return invoice;

    const payments = Array.isArray(invoice.payments) ? [...invoice.payments] : [];
    let amountPaid = invoice.amountPaid != null ? roundMoney(invoice.amountPaid) : null;

    if (invoice.status === 'paid') {
        const total = roundMoney(invoice.total);
        if (amountPaid == null || amountPaid <= 0) {
            amountPaid = total;
        }
        if (payments.length === 0 && amountPaid > 0) {
            payments.push({
                amount: amountPaid,
                method: PAYMENT_METHODS.includes(invoice.paymentMethod)
                    ? invoice.paymentMethod
                    : 'cash',
                date: invoice.datePaid || new Date().toISOString(),
                note: '',
                createdAt: invoice.datePaid ? new Date(invoice.datePaid) : new Date(),
            });
        }
    } else if (amountPaid == null) {
        amountPaid = sumPayments(payments);
    }

    invoice.payments = payments;
    invoice.amountPaid = amountPaid;
    return invoice;
}

export function sanitizePaymentPayload(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw validationError('Invalid payment payload.');
    }

    const amount = sanitizeNumber(body.amount, { min: 0, max: 1_000_000_000, fallback: NaN });
    if (!Number.isFinite(amount) || amount <= 0) {
        throw validationError('Payment amount must be greater than zero.');
    }

    const method = sanitizePlainText(body.method ?? body.paymentMethod, 40);
    if (!PAYMENT_METHODS.includes(method)) {
        throw validationError(
            'Payment method is required (cash, bank_transfer, pos, card, or online_gateway).'
        );
    }

    let date = body.date ?? body.datePaid;
    if (date == null || date === '') {
        date = new Date().toISOString();
    } else {
        date = sanitizePlainText(String(date), 64);
        if (!date) {
            throw validationError('Invalid payment date.');
        }
    }

    const note =
        body.note !== undefined && body.note !== null
            ? sanitizePlainText(body.note, 500)
            : '';

    return {
        amount: roundMoney(amount),
        method,
        date,
        note,
    };
}

/**
 * Apply a payment to an invoice document (mutates in-memory fields; caller saves).
 * Returns { becamePaid, payment, balanceDue }.
 */
export function applyInvoicePayment(invoice, paymentInput) {
    if (!PAYABLE_STATUSES.includes(invoice.status)) {
        throw validationError('Payments can only be recorded on pending, partial, or overdue invoices.');
    }

    ensurePaymentLedger(invoice);

    const payment = {
        ...sanitizePaymentPayload(paymentInput),
        createdAt: new Date(),
    };

    const balanceDue = getInvoiceBalanceDue(invoice);
    if (payment.amount > balanceDue + MONEY_EPS) {
        throw validationError(
            `Payment amount exceeds the balance due (${balanceDue.toFixed(2)}).`
        );
    }
    // Clamp tiny float overages
    if (payment.amount > balanceDue) {
        payment.amount = balanceDue;
    }

    const payments = [...(invoice.payments || []), payment];
    const amountPaid = sumPayments(payments);
    const nextStatus = resolvePaymentStatus(invoice, { amountPaid });

    invoice.payments = payments;
    invoice.amountPaid = amountPaid;
    invoice.paymentMethod = payment.method;
    invoice.datePaid = payment.date;
    invoice.status = nextStatus;

    return {
        becamePaid: nextStatus === 'paid',
        payment,
        balanceDue: getInvoiceBalanceDue(invoice),
        amountPaid,
    };
}

/**
 * When an invoice is marked paid via legacy PUT, sync the payments ledger for the remainder.
 */
export function syncFullPaymentFromMarkPaid(invoice, { paymentMethod, datePaid } = {}) {
    ensurePaymentLedger(invoice);
    const balanceDue = getInvoiceBalanceDue(invoice);
    if (balanceDue <= MONEY_EPS && invoice.status === 'paid') {
        return { becamePaid: true, alreadySettled: true };
    }

    if (balanceDue > MONEY_EPS) {
        return applyInvoicePayment(invoice, {
            amount: balanceDue,
            method: paymentMethod || invoice.paymentMethod,
            date: datePaid || invoice.datePaid || new Date().toISOString(),
        });
    }

    invoice.status = 'paid';
    invoice.amountPaid = roundMoney(invoice.total);
    return { becamePaid: true, alreadySettled: true };
}

export { PAYABLE_STATUSES, PAYMENT_METHODS, MONEY_EPS };
