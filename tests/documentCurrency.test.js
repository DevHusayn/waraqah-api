import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyDocumentBaseAmounts,
    computeBaseAmounts,
    exchangeRateForBooks,
    projectDocIntoBooks,
    projectDocsIntoBooks,
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
