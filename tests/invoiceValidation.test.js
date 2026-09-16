import test from 'node:test';
import assert from 'node:assert/strict';
import {
    assertInvoiceDeleteAllowed,
    normalizeInvoicePayload,
    sanitizeInvoicePayload,
} from '../utils/invoiceValidation.js';

test('sanitizeInvoicePayload rejects invalid status', () => {
    assert.throws(
        () => sanitizeInvoicePayload({ status: 'hacked' }),
        (err) => err.message.includes('Invalid')
    );
});

test('sanitizeInvoicePayload accepts recurring fields', () => {
    const payload = sanitizeInvoicePayload({
        status: 'pending',
        isRecurring: true,
        recurringFrequency: 'monthly',
        recurringEndDate: '2026-12-31',
        items: [{ description: 'Consulting', quantity: 1, rate: 50000 }],
    });

    assert.equal(payload.isRecurring, true);
    assert.equal(payload.recurringFrequency, 'monthly');
    assert.equal(payload.recurringEndDate, '2026-12-31');
});

test('sanitizeInvoicePayload drops unknown recurring frequencies', () => {
    const payload = sanitizeInvoicePayload({
        status: 'pending',
        isRecurring: true,
        recurringFrequency: 'daily',
        items: [{ description: 'Consulting', quantity: 1, rate: 50000 }],
    });

    assert.equal(payload.recurringFrequency, undefined);
});

test('sanitizeInvoicePayload rejects invalid recurring end dates', () => {
    assert.throws(
        () =>
            sanitizeInvoicePayload({
                status: 'pending',
                isRecurring: true,
                recurringFrequency: 'monthly',
                recurringEndDate: '31-12-2026',
            }),
        (err) => err.message.includes('valid recurring end date')
    );
});

test('normalizeInvoicePayload sets next date for recurring pending invoices', () => {
    const payload = normalizeInvoicePayload(
        {
            status: 'pending',
            date: '2026-08-26',
            isRecurring: true,
            recurringFrequency: 'monthly',
            items: [{ description: 'Retainer', quantity: 1, rate: 10000 }],
        },
        { isCreate: true }
    );

    assert.equal(payload.isRecurring, true);
    assert.equal(payload.recurringNextDate, '2026-09-26');
});

test('normalizeInvoicePayload keeps drafts from generating a next date', () => {
    const payload = normalizeInvoicePayload(
        {
            status: 'draft',
            date: '2026-08-26',
            isRecurring: true,
            recurringFrequency: 'weekly',
            items: [{ description: 'Retainer', quantity: 1, rate: 10000 }],
        },
        { isCreate: true }
    );

    assert.equal(payload.isRecurring, true);
    assert.equal(payload.recurringNextDate, null);
});

test('sanitizeInvoicePayload accepts valid draft invoice', () => {
    const payload = sanitizeInvoicePayload({
        status: 'draft',
        items: [{ description: 'Design work', quantity: 2, rate: 25000, unit: 'Hours' }],
        taxRate: 7.5,
        discountType: 'percent',
        discountValue: 10,
    });

    assert.equal(payload.status, 'draft');
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].description, 'Design work');
    assert.equal(payload.items[0].unit, 'Hours');
});

test('sanitizeInvoicePayload defaults missing unit to Qty', () => {
    const payload = sanitizeInvoicePayload({
        status: 'draft',
        items: [{ description: 'Widget', quantity: 1, rate: 100 }],
    });

    assert.equal(payload.items[0].unit, 'Qty');
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

test('sanitizeInvoicePayload accepts any valid ISO currency', () => {
    const payload = sanitizeInvoicePayload({ status: 'draft', currency: 'jpy' });
    assert.equal(payload.currency, 'JPY');
});

test('sanitizeInvoicePayload rejects invalid currency codes', () => {
    assert.throws(
        () => sanitizeInvoicePayload({ status: 'draft', currency: 'XXX' }),
        (err) => err.status === 400 && /currency/i.test(err.message)
    );
});
