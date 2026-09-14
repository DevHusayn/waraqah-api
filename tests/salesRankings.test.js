import test from 'node:test';
import assert from 'node:assert/strict';
import {
    rankBestSellingProducts,
    rankBestBuyingClients,
} from '../utils/salesRankings.js';

const TZ = 'Africa/Lagos';
const MARCH = { kind: 'month', year: 2026, month: 3 };

function paidInvoice(overrides = {}) {
    return {
        status: 'paid',
        documentType: 'invoice',
        date: new Date('2026-03-15T12:00:00.000Z'),
        total: 1000,
        amountPaid: 1000,
        discount: 0,
        items: [],
        ...overrides,
    };
}

test('rankBestSellingProducts excludes unpaid invoices', () => {
    const docs = [
        paidInvoice({
            status: 'pending',
            amountPaid: 0,
            items: [{ productId: 'p1', description: 'Chair', quantity: 5, rate: 200 }],
        }),
    ];

    assert.deepEqual(rankBestSellingProducts(docs, { period: MARCH, timeZone: TZ }), []);
});

test('rankBestSellingProducts scales partial payments by paid ratio', () => {
    const docs = [
        paidInvoice({
            status: 'partial',
            total: 1000,
            amountPaid: 500,
            items: [{ productId: 'p1', description: 'Chair', quantity: 4, rate: 250 }],
        }),
    ];

    const items = rankBestSellingProducts(docs, { period: MARCH, timeZone: TZ });
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'p1');
    assert.equal(items[0].qtySold, 2);
    assert.equal(items[0].revenue, 500);
});

test('rankBestSellingProducts skips line items without productId', () => {
    const docs = [
        paidInvoice({
            items: [
                { description: 'Custom work', quantity: 1, rate: 1000 },
                { productId: 'p1', description: 'Lamp', quantity: 2, rate: 100 },
            ],
            total: 1200,
            amountPaid: 1200,
        }),
    ];

    const items = rankBestSellingProducts(docs, { period: MARCH, timeZone: TZ });
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'p1');
    assert.equal(items[0].qtySold, 2);
});

test('rankBestSellingProducts filters by document date period', () => {
    const docs = [
        paidInvoice({
            date: new Date('2026-04-02T12:00:00.000Z'),
            items: [{ productId: 'p1', description: 'April', quantity: 9, rate: 100 }],
        }),
        paidInvoice({
            items: [{ productId: 'p2', description: 'March', quantity: 1, rate: 100 }],
        }),
    ];

    const items = rankBestSellingProducts(docs, { period: MARCH, timeZone: TZ });
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'p2');
});

test('rankBestSellingProducts sorts by qty then revenue and applies limit', () => {
    const docs = [
        paidInvoice({
            items: [
                { productId: 'low-qty', description: 'Low', quantity: 1, rate: 900 },
                { productId: 'tie-a', description: 'Tie A', quantity: 5, rate: 10 },
                { productId: 'tie-b', description: 'Tie B', quantity: 5, rate: 50 },
                { productId: 'top', description: 'Top', quantity: 8, rate: 20 },
            ],
            total: 1400,
            amountPaid: 1400,
        }),
    ];

    const items = rankBestSellingProducts(docs, { period: MARCH, timeZone: TZ, limit: 3 });
    assert.deepEqual(
        items.map((row) => row.id),
        ['top', 'tie-b', 'tie-a']
    );
});

test('rankBestSellingProducts uses catalog name when provided', () => {
    const docs = [
        paidInvoice({
            items: [{ productId: 'p1', description: 'Line name', quantity: 1, rate: 100 }],
            total: 100,
            amountPaid: 100,
        }),
    ];
    const nameById = new Map([['p1', 'Catalog Chair']]);

    const items = rankBestSellingProducts(docs, { period: MARCH, timeZone: TZ, nameById });
    assert.equal(items[0].name, 'Catalog Chair');
});

test('rankBestBuyingClients excludes unpaid invoices', () => {
    const docs = [
        paidInvoice({
            status: 'overdue',
            amountPaid: 0,
            clientId: 'c1',
            clientName: 'Ada',
        }),
    ];

    assert.deepEqual(rankBestBuyingClients(docs, { period: MARCH, timeZone: TZ }), []);
});

test('rankBestBuyingClients skips documents without a client', () => {
    const docs = [paidInvoice({ clientId: null, clientName: '' })];
    assert.deepEqual(rankBestBuyingClients(docs, { period: MARCH, timeZone: TZ }), []);
});

test('rankBestBuyingClients uses snapshot name when clientId is missing', () => {
    const docs = [paidInvoice({ clientId: null, clientName: 'Walk-in' })];
    const items = rankBestBuyingClients(docs, { period: MARCH, timeZone: TZ });
    assert.equal(items.length, 1);
    assert.equal(items[0].id, null);
    assert.equal(items[0].name, 'Walk-in');
    assert.equal(items[0].revenue, 1000);
    assert.equal(items[0].documentCount, 1);
});

test('rankBestBuyingClients filters by document date period', () => {
    const docs = [
        paidInvoice({
            date: new Date('2026-02-10T12:00:00.000Z'),
            clientId: 'c1',
            clientName: 'Feb',
            total: 5000,
            amountPaid: 5000,
        }),
        paidInvoice({
            clientId: 'c2',
            clientName: 'March',
            total: 100,
            amountPaid: 100,
        }),
    ];

    const items = rankBestBuyingClients(docs, { period: MARCH, timeZone: TZ });
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'c2');
});

test('rankBestBuyingClients sorts by revenue then document count', () => {
    const docs = [
        paidInvoice({ clientId: 'c-low', clientName: 'Low', total: 100, amountPaid: 100 }),
        paidInvoice({ clientId: 'c-tie', clientName: 'Tie', total: 400, amountPaid: 400 }),
        paidInvoice({ clientId: 'c-many', clientName: 'Many', total: 200, amountPaid: 200 }),
        paidInvoice({ clientId: 'c-many', clientName: 'Many', total: 200, amountPaid: 200 }),
        paidInvoice({ clientId: 'c-top', clientName: 'Top', total: 900, amountPaid: 900 }),
    ];

    const items = rankBestBuyingClients(docs, { period: MARCH, timeZone: TZ, limit: 3 });
    assert.deepEqual(
        items.map((row) => row.id),
        ['c-top', 'c-many', 'c-tie']
    );
    assert.equal(items[1].documentCount, 2);
});

test('rankBestBuyingClients counts paid receipts', () => {
    const docs = [
        paidInvoice({
            documentType: 'receipt',
            status: 'paid',
            clientId: 'c1',
            clientName: 'Receipt buyer',
            total: 250,
            amountPaid: 250,
        }),
    ];

    const items = rankBestBuyingClients(docs, { period: MARCH, timeZone: TZ });
    assert.equal(items[0].revenue, 250);
});
