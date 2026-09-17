import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyDocumentBaseAmounts,
    computeBaseAmounts,
    exchangeRateForBooks,
    projectDocIntoBooks,
    projectDocsIntoBooks,
    rebaseDocumentBooks,
    correctDocumentBooksRate,
    booksRebaseCorrectionFactor,
} from '../utils/documentCurrency.js';
import { computePeriodSummaryFromDocs } from '../utils/dashboardAnalytics.js';

test('applyDocumentBaseAmounts uses rate 1 for matching currencies', () => {
    const payload = applyDocumentBaseAmounts(
        { currency: 'NGN', subtotal: 100, tax: 0, discount: 0, total: 100 },
        { businessCurrency: 'NGN', amountPaid: 40 }
    );
    assert.equal(payload.exchangeRate, 1);
    assert.equal(payload.baseCurrency, 'NGN');
    assert.equal(payload.baseTotal, 100);
    assert.equal(payload.baseAmountPaid, 40);
});

test('applyDocumentBaseAmounts converts foreign currency with a user rate', () => {
    const payload = applyDocumentBaseAmounts(
        { currency: 'USD', exchangeRate: 1500, subtotal: 10, tax: 0, discount: 0, total: 10 },
        { businessCurrency: 'NGN', amountPaid: 0 }
    );
    assert.equal(payload.baseCurrency, 'NGN');
    assert.equal(payload.baseTotal, 15000);
});

test('applyDocumentBaseAmounts requires a rate when currencies differ', () => {
    assert.throws(
        () =>
            applyDocumentBaseAmounts(
                { currency: 'USD', total: 10, subtotal: 10 },
                { businessCurrency: 'NGN' }
            ),
        (err) => err.status === 400 && /NGN/i.test(err.message)
    );
});

test('legacy same-currency documents stay in books totals', () => {
    const doc = { currency: 'NGN', status: 'paid', total: 1000, amountPaid: 1000 };
    assert.equal(exchangeRateForBooks(doc, 'NGN'), 1);
    const projected = projectDocIntoBooks(doc, 'NGN');
    assert.equal(projected.total, 1000);
});

test('unconverted foreign documents are excluded from books totals', () => {
    const doc = { currency: 'USD', status: 'paid', total: 10, amountPaid: 10 };
    assert.equal(exchangeRateForBooks(doc, 'NGN'), null);
    assert.equal(projectDocIntoBooks(doc, 'NGN'), null);
});

test('converted foreign documents contribute naira to period summary', () => {
    const docs = [
        {
            date: '2026-03-10',
            status: 'paid',
            total: 1000,
            amountPaid: 1000,
            currency: 'NGN',
            documentType: 'invoice',
        },
        {
            date: '2026-03-11',
            status: 'paid',
            total: 10,
            amountPaid: 10,
            currency: 'USD',
            exchangeRate: 1500,
            baseCurrency: 'NGN',
            baseTotal: 15000,
            baseAmountPaid: 15000,
            documentType: 'invoice',
        },
        {
            date: '2026-03-12',
            status: 'paid',
            total: 50,
            amountPaid: 50,
            currency: 'EUR',
            documentType: 'invoice',
        },
    ];
    const books = projectDocsIntoBooks(docs, 'NGN');
    const summary = computePeriodSummaryFromDocs(books, 2026, 3, 'UTC');
    assert.equal(summary.totalRevenue, 16000);
});

test('computeBaseAmounts rounds to cents', () => {
    const base = computeBaseAmounts({ total: 10.555, exchangeRate: 2 });
    assert.equal(base.baseTotal, 21.11);
});

test('rebaseDocumentBooks converts matching books into the new currency', () => {
    const patch = rebaseDocumentBooks(
        {
            currency: 'NGN',
            exchangeRate: 1,
            baseCurrency: 'NGN',
            subtotal: 1500000,
            tax: 0,
            discount: 0,
            total: 1500000,
            amountPaid: 500000,
            baseTotal: 1500000,
            baseAmountPaid: 500000,
            items: [{ description: 'Widget', quantity: 1, rate: 1500000, unitCost: 900000 }],
        },
        { fromCurrency: 'NGN', toCurrency: 'USD', rate: 0.00067, kind: 'invoice' }
    );
    assert.equal(patch.baseCurrency, 'USD');
    assert.equal(patch.exchangeRate, 0.00067);
    assert.equal(patch.baseTotal, 1005);
    assert.equal(patch.items[0].unitCost, 603);
    assert.equal(patch.items[0].rate, 1500000);
});

test('rebaseDocumentBooks snaps invoices already in the new currency', () => {
    const patch = rebaseDocumentBooks(
        {
            currency: 'USD',
            exchangeRate: 1500,
            baseCurrency: 'NGN',
            total: 10,
            amountPaid: 10,
            baseTotal: 15000,
            items: [{ description: 'Widget', quantity: 1, rate: 10, unitCost: 6000 }],
        },
        { fromCurrency: 'NGN', toCurrency: 'USD', rate: 0.00067, kind: 'invoice' }
    );
    assert.equal(patch.exchangeRate, 1);
    assert.equal(patch.baseTotal, 10);
    assert.equal(patch.items[0].unitCost, 4.02);
});

test('rebaseDocumentBooks compounds a third currency into the new books', () => {
    const patch = rebaseDocumentBooks(
        {
            currency: 'EUR',
            exchangeRate: 1600,
            baseCurrency: 'NGN',
            total: 10,
            baseTotal: 16000,
        },
        { fromCurrency: 'NGN', toCurrency: 'USD', rate: 0.00067 }
    );
    assert.equal(patch.exchangeRate, 1.072);
    assert.equal(patch.baseTotal, 10.72);
});

test('correctDocumentBooksRate restates NGN books after a rate typo', () => {
    const patch = correctDocumentBooksRate(
        {
            currency: 'NGN',
            exchangeRate: 0.00067,
            baseCurrency: 'USD',
            subtotal: 1500000,
            tax: 0,
            discount: 0,
            total: 1500000,
            amountPaid: 500000,
            baseTotal: 1005,
            items: [{ description: 'Widget', quantity: 1, rate: 1500000, unitCost: 603 }],
        },
        { fromCurrency: 'NGN', toCurrency: 'USD', oldRate: 0.00067, newRate: 0.0008, kind: 'invoice' }
    );
    assert.equal(patch.exchangeRate, 0.0008);
    assert.equal(patch.baseTotal, 1200);
    assert.equal(patch.items[0].unitCost, 720);
});

test('booksRebaseCorrectionFactor is 1 when the rate is unchanged', () => {
    assert.equal(booksRebaseCorrectionFactor(0.00067, 0.00067), 1);
});
