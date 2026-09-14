import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildStockAlertCopy,
    formatLowStockLine,
    formatOutOfStockLine,
} from '../src/emails/helpers/stockAlert.js';

const low = { name: 'Notebook', quantityOnHand: 2, lowStockThreshold: 5 };
const out = { name: 'Pen', quantityOnHand: 0 };

test('buildStockAlertCopy keeps low-stock wording when only low stock exists', () => {
    const copy = buildStockAlertCopy({ ownerName: 'Ada', products: [low] });
    assert.equal(copy.heading, 'Low stock alert');
    assert.equal(copy.subject, 'Low stock: Notebook');
    assert.equal(copy.preview, 'Notebook is low on stock.');
    assert.match(copy.intro, /Ada/);
    assert.match(copy.intro, /low-stock threshold/);
});

test('buildStockAlertCopy uses out-of-stock wording when nothing is low', () => {
    const copy = buildStockAlertCopy({
        ownerName: 'Ada',
        products: [],
        outOfStockProducts: [out],
    });
    assert.equal(copy.heading, 'Out of stock alert');
    assert.equal(copy.subject, 'Out of stock: Pen');
    assert.equal(copy.preview, 'Pen is out of stock.');
    assert.match(copy.intro, /no units on hand/);
});

test('buildStockAlertCopy covers both lists in one stock alert', () => {
    const copy = buildStockAlertCopy({
        ownerName: 'Ada',
        products: [low],
        outOfStockProducts: [out, { name: 'Ink', quantityOnHand: -1 }],
    });
    assert.equal(copy.heading, 'Stock alert');
    assert.equal(copy.subject, 'Stock alert — 3 products need attention');
    assert.match(copy.preview, /1 product is low on stock/);
    assert.match(copy.preview, /2 are out of stock/);
    assert.match(copy.intro, /1 tracked product is at or below its low-stock threshold/);
    assert.match(copy.footer, /low or out of stock/);
});

test('format lines distinguish threshold alerts from empty stock', () => {
    assert.equal(formatLowStockLine(low), '2 on hand · alert at 5 or below');
    assert.equal(formatOutOfStockLine(out), '0 on hand · out of stock');
    assert.equal(formatOutOfStockLine({ quantityOnHand: -2 }), '-2 on hand · out of stock');
});
