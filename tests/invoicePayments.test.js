import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyInvoicePayment,
    getInvoiceBalanceDue,
    resolvePaymentStatus,
} from '../utils/invoicePayments.js';

test('resolvePaymentStatus returns partial when partly paid and not past due', () => {
    assert.equal(
        resolvePaymentStatus(
            { total: 1000, dueDate: '2099-01-01' },
            { amountPaid: 250, today: '2026-07-24' }
        ),
        'partial'
    );
});

test('resolvePaymentStatus returns overdue when partly paid and past due', () => {
    assert.equal(
        resolvePaymentStatus(
            { total: 1000, dueDate: '2020-01-01' },
            { amountPaid: 250, today: '2026-07-24' }
        ),
        'overdue'
    );
});

test('resolvePaymentStatus returns paid when amount covers total', () => {
    assert.equal(
        resolvePaymentStatus({ total: 1000, dueDate: '2099-01-01' }, { amountPaid: 1000 }),
        'paid'
    );
});

test('applyInvoicePayment records installment and updates status', () => {
    const invoice = {
        status: 'pending',
        total: 1000,
        dueDate: '2099-01-01',
        amountPaid: 0,
        payments: [],
    };

    const result = applyInvoicePayment(invoice, {
        amount: 400,
        method: 'cash',
        date: '2026-07-24',
    });

    assert.equal(result.becamePaid, false);
    assert.equal(invoice.status, 'partial');
    assert.equal(invoice.amountPaid, 400);
    assert.equal(getInvoiceBalanceDue(invoice), 600);
    assert.equal(invoice.payments.length, 1);
});

test('applyInvoicePayment settles invoice when balance cleared', () => {
    const invoice = {
        status: 'partial',
        total: 1000,
        dueDate: '2099-01-01',
        amountPaid: 600,
        payments: [{ amount: 600, method: 'cash', date: '2026-07-01' }],
        paymentMethod: 'cash',
        datePaid: '2026-07-01',
    };

    const result = applyInvoicePayment(invoice, {
        amount: 400,
        method: 'bank_transfer',
        date: '2026-07-24',
    });

    assert.equal(result.becamePaid, true);
    assert.equal(invoice.status, 'paid');
    assert.equal(invoice.amountPaid, 1000);
    assert.equal(getInvoiceBalanceDue(invoice), 0);
});

test('applyInvoicePayment rejects overpayment', () => {
    const invoice = {
        status: 'pending',
        total: 100,
        dueDate: '2099-01-01',
        amountPaid: 0,
        payments: [],
    };

    assert.throws(
        () =>
            applyInvoicePayment(invoice, {
                amount: 150,
                method: 'cash',
                date: '2026-07-24',
            }),
        (err) => err.message.includes('exceeds')
    );
});
