import test from 'node:test';
import assert from 'node:assert/strict';
import {
    assertInvoiceDeleteAllowed,
    sanitizeInvoicePayload,
} from '../utils/invoiceValidation.js';

test('sanitizeInvoicePayload rejects invalid status', () => {
    assert.throws(
        () => sanitizeInvoicePayload({ status: 'hacked' }),
        (err) => err.message.includes('Invalid')
    );
});

test('sanitizeInvoicePayload disables recurring invoices', () => {
    const payload = sanitizeInvoicePayload({
        status: 'pending',
        isRecurring: true,
        recurringFrequency: 'monthly',
        recurringEndDate: '2026-12-31',
        items: [{ description: 'Consulting', quantity: 1, rate: 50000 }],
    });

    assert.equal(payload.isRecurring, false);
    assert.equal(payload.recurringFrequency, undefined);
    assert.equal(payload.recurringEndDate, undefined);
});

test('sanitizeInvoicePayload accepts valid draft invoice', () => {
    const payload = sanitizeInvoicePayload({
        status: 'draft',
        items: [{ description: 'Design work', quantity: 2, rate: 25000 }],
        taxRate: 7.5,
        discountType: 'percent',
        discountValue: 10,
    });

    assert.equal(payload.status, 'draft');
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].description, 'Design work');
});

test('assertInvoiceDeleteAllowed rejects paid invoices', () => {
    assert.throws(
        () => assertInvoiceDeleteAllowed({ status: 'paid' }),
        (err) => err.message.includes('Paid invoices cannot be deleted')
    );
});

test('assertInvoiceDeleteAllowed rejects cancelled invoices', () => {
    assert.throws(
        () => assertInvoiceDeleteAllowed({ status: 'cancelled' }),
        (err) => err.message.includes('Cancelled invoices cannot be deleted')
    );
});

test('assertInvoiceDeleteAllowed allows pending invoices', () => {
    assert.doesNotThrow(() => assertInvoiceDeleteAllowed({ status: 'pending' }));
});
