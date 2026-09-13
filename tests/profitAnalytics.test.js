import test from 'node:test';
import assert from 'node:assert/strict';
import {
    computeDocumentProfit,
    computePeriodProfitFromDocs,
    buildProfitTrendFromDocs,
    buildProfitSummaryFromDocs,
} from '../utils/profitAnalytics.js';
import { computeWeightedAverageCost } from '../utils/itemCostSnapshot.js';

test('computeWeightedAverageCost uses PO rate when stock was zero', () => {
    assert.equal(computeWeightedAverageCost(0, 0, 10, 500), 500);
});

test('computeWeightedAverageCost blends existing and incoming stock', () => {
    assert.equal(computeWeightedAverageCost(10, 400, 10, 600), 500);
});

test('computeDocumentProfit scales partial payments by paid ratio', () => {
    const doc = {
        status: 'partial',
        total: 1000,
        amountPaid: 500,
        discount: 0,
        items: [
            {
                productId: 'p1',
                quantity: 2,
                rate: 500,
                unitCost: 200,
            },
        ],
    };

    const profit = computeDocumentProfit(doc);
    assert.equal(profit.revenue, 500);
    assert.equal(profit.cogs, 200);
    assert.equal(profit.grossProfit, 300);
});

test('computeDocumentProfit allocates fixed discount proportionally', () => {
    const doc = {
        status: 'paid',
        total: 900,
        amountPaid: 900,
        discount: 100,
        items: [
            {
                productId: 'p1',
                quantity: 1,
                rate: 1000,
                unitCost: 400,
            },
        ],
    };

    const profit = computeDocumentProfit(doc);
    assert.equal(profit.revenue, 900);
    assert.equal(profit.cogs, 400);
    assert.equal(profit.grossProfit, 500);
});

test('computeDocumentProfit tracks lines missing cost data', () => {
    const doc = {
        status: 'paid',
        total: 500,
        amountPaid: 500,
        discount: 0,
        items: [
            {
                productId: 'p1',
                quantity: 1,
                rate: 500,
                unitCost: 0,
            },
        ],
    };

    const profit = computeDocumentProfit(doc);
    assert.equal(profit.linesMissingCost, 1);
    assert.equal(profit.linesWithCost, 0);
    assert.equal(profit.revenue, 500);
    assert.equal(profit.grossProfit, 0);
});

test('computeDocumentProfit treats service lines as full-margin profit', () => {
    const doc = {
        status: 'paid',
        total: 500,
        amountPaid: 500,
        discount: 0,
        items: [
            {
                description: 'Consulting',
                quantity: 1,
                rate: 500,
            },
        ],
    };

    const profit = computeDocumentProfit(doc);
    assert.equal(profit.revenue, 500);
    assert.equal(profit.cogs, 0);
    assert.equal(profit.grossProfit, 500);
    assert.equal(profit.linesMissingCost, 0);
});

test('computeDocumentProfit mixes product cost with service-line margin', () => {
    const doc = {
        status: 'paid',
        total: 700,
        amountPaid: 700,
        discount: 0,
        items: [
            {
                productId: 'p1',
                quantity: 1,
                rate: 500,
                unitCost: 200,
            },
            {
                description: 'Installation',
                quantity: 1,
                rate: 200,
            },
        ],
    };

    const profit = computeDocumentProfit(doc);
    assert.equal(profit.revenue, 700);
    assert.equal(profit.cogs, 200);
    assert.equal(profit.grossProfit, 500);
    assert.equal(profit.linesWithCost, 1);
    assert.equal(profit.linesMissingCost, 0);
});

test('computeDocumentProfit treats untracked zero-cost catalog products as full-margin services', () => {
    const productCostById = new Map([
        ['consulting', { unitCost: 0, trackInventory: false }],
    ]);
    const doc = {
        status: 'paid',
        total: 800,
        amountPaid: 800,
        discount: 0,
        items: [
            {
                productId: 'consulting',
                description: 'Website design',
                quantity: 1,
                rate: 800,
                unitCost: 0,
            },
        ],
    };

    const profit = computeDocumentProfit(doc, productCostById);
    assert.equal(profit.revenue, 800);
    assert.equal(profit.cogs, 0);
    assert.equal(profit.grossProfit, 800);
    assert.equal(profit.linesMissingCost, 0);
    assert.equal(profit.linesWithCost, 0);
});

test('computeDocumentProfit uses cost on untracked products when unit cost is set', () => {
    const productCostById = new Map([
        ['consulting', { unitCost: 50, trackInventory: false }],
    ]);
    const doc = {
        status: 'paid',
        total: 800,
        amountPaid: 800,
        discount: 0,
        items: [
            {
                productId: 'consulting',
                quantity: 1,
                rate: 800,
                unitCost: 0,
            },
        ],
    };

    const profit = computeDocumentProfit(doc, productCostById);
    assert.equal(profit.cogs, 50);
    assert.equal(profit.grossProfit, 750);
    assert.equal(profit.linesWithCost, 1);
    assert.equal(profit.linesMissingCost, 0);
});

test('computeDocumentProfit still flags tracked products that are missing cost', () => {
    const productCostById = new Map([
        ['p1', { unitCost: 0, trackInventory: true }],
    ]);
    const doc = {
        status: 'paid',
        total: 500,
        amountPaid: 500,
        discount: 0,
        items: [
            {
                productId: 'p1',
                quantity: 1,
                rate: 500,
                unitCost: 0,
            },
        ],
    };

    const profit = computeDocumentProfit(doc, productCostById);
    assert.equal(profit.linesMissingCost, 1);
    assert.equal(profit.grossProfit, 0);
});

test('computeDocumentProfit falls back to catalog cost when line snapshot is missing', () => {
    const productCostById = new Map([['p1', 200]]);
    const doc = {
        status: 'paid',
        total: 500,
        amountPaid: 500,
        discount: 0,
        items: [
            {
                productId: 'p1',
                quantity: 1,
                rate: 500,
                unitCost: 0,
            },
        ],
    };

    const profit = computeDocumentProfit(doc, productCostById);
    assert.equal(profit.linesMissingCost, 0);
    assert.equal(profit.linesWithCost, 1);
    assert.equal(profit.cogs, 200);
    assert.equal(profit.grossProfit, 300);
});

test('computePeriodProfitFromDocs buckets by issue month', () => {
    const docs = [
        {
            date: '2026-02-10T00:00:00.000Z',
            status: 'paid',
            total: 1000,
            amountPaid: 1000,
            discount: 0,
            items: [{ productId: 'p1', description: 'Widget', quantity: 2, rate: 500, unitCost: 300 }],
        },
        {
            date: '2026-01-15T00:00:00.000Z',
            status: 'paid',
            total: 400,
            amountPaid: 400,
            discount: 0,
            items: [{ productId: 'p1', description: 'Widget', quantity: 1, rate: 400, unitCost: 100 }],
        },
    ];

    const feb = computePeriodProfitFromDocs(docs, 2026, 2, 'UTC');
    assert.equal(feb.totals.revenue, 1000);
    assert.equal(feb.totals.cogs, 600);
    assert.equal(feb.totals.grossProfit, 400);
    assert.equal(feb.byProduct.length, 1);
});

test('computePeriodProfitFromDocs includes untracked zero-cost services in product profit', () => {
    const productCostById = new Map([
        ['consulting', { unitCost: 0, trackInventory: false }],
    ]);
    const docs = [
        {
            date: '2026-02-10T00:00:00.000Z',
            status: 'paid',
            total: 800,
            amountPaid: 800,
            discount: 0,
            items: [
                {
                    productId: 'consulting',
                    description: 'Website design',
                    quantity: 1,
                    rate: 800,
                    unitCost: 0,
                },
            ],
        },
    ];

    const feb = computePeriodProfitFromDocs(docs, 2026, 2, 'UTC', productCostById);
    assert.equal(feb.totals.grossProfit, 800);
    assert.equal(feb.totals.linesMissingCost, 0);
    assert.equal(feb.byProduct.length, 1);
    assert.equal(feb.byProduct[0].grossProfit, 800);
});

test('buildProfitTrendFromDocs fills monthly gross profit buckets', () => {
    const docs = [
        {
            date: '2026-02-10T00:00:00.000Z',
            status: 'paid',
            total: 200,
            amountPaid: 200,
            discount: 0,
            items: [{ productId: 'p1', quantity: 1, rate: 200, unitCost: 50 }],
        },
    ];

    const trend = buildProfitTrendFromDocs(docs, {
        months: 2,
        timeZone: 'UTC',
        now: new Date('2026-02-28T12:00:00.000Z'),
    });

    assert.equal(trend.length, 2);
    assert.equal(trend[1].grossProfit, 150);
});

test('buildProfitSummaryFromDocs omits comparison for all-time', () => {
    const docs = [
        {
            date: '2026-01-10T00:00:00.000Z',
            status: 'paid',
            total: 400,
            amountPaid: 400,
            discount: 0,
            items: [{ productId: 'p1', quantity: 1, rate: 400, unitCost: 100 }],
        },
        {
            date: '2026-02-10T00:00:00.000Z',
            status: 'paid',
            total: 600,
            amountPaid: 600,
            discount: 0,
            items: [{ productId: 'p1', quantity: 1, rate: 600, unitCost: 200 }],
        },
    ];

    const summary = buildProfitSummaryFromDocs(docs, {
        period: { kind: 'all' },
        timeZone: 'UTC',
    });

    assert.equal(summary.period.kind, 'all');
    assert.equal(summary.totals.grossProfit, 700);
    assert.equal(summary.comparison, null);
});

test('buildProfitSummaryFromDocs compares today to yesterday', () => {
    const docs = [
        {
            date: '2026-08-14T12:00:00.000Z',
            status: 'paid',
            total: 12000,
            amountPaid: 12000,
            discount: 0,
            items: [{ productId: 'p1', quantity: 1, rate: 12000, unitCost: 2000 }],
        },
        {
            date: '2026-08-13T12:00:00.000Z',
            status: 'paid',
            total: 6000,
            amountPaid: 6000,
            discount: 0,
            items: [{ productId: 'p1', quantity: 1, rate: 6000, unitCost: 1000 }],
        },
    ];

    const summary = buildProfitSummaryFromDocs(docs, {
        period: { kind: 'day', year: 2026, month: 8, day: 14 },
        timeZone: 'UTC',
    });

    assert.equal(summary.totals.grossProfit, 10000);
    assert.equal(summary.comparison.grossProfit.direction, 'up');
});
