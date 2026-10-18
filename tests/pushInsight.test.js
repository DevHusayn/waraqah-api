import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPremiumExpiryPush, buildStatementPush, chooseInsight, shouldSendInsight } from '../utils/pushInsight.js';

const quiet = {
    overdueCount: 0,
    overdueAmount: 0,
    outstanding: 0,
    collected: 0,
    collectedComparison: { direction: 'flat' },
    dueSoonCount: 0,
};

test('chooseInsight prefers overdue over outstanding', () => {
    const insight = chooseInsight({
        ...quiet,
        overdueCount: 3,
        overdueAmount: 120000,
        outstanding: 450000,
        currency: 'NGN',
    });
    assert.equal(insight.title, 'Overdue invoices');
    assert.match(insight.body, /3 invoices are overdue/);
    assert.equal(insight.fingerprint, 'overdue:3:120000');
    assert.doesNotMatch(insight.body, /out of stock/);
    assert.equal(insight.tag, 'daily-insight');
});

test('chooseInsight reports outstanding when nothing is overdue', () => {
    const insight = chooseInsight({
        ...quiet,
        outstanding: 450000,
        dueSoonCount: 2,
        currency: 'NGN',
    });
    assert.equal(insight.title, 'Outstanding this month');
    assert.match(insight.body, /still outstanding on invoices issued this month/);
    assert.match(insight.body, /2 are due in the next 7 days/);
});

test('chooseInsight adds low stock to a briefing and does not send stock on its own', () => {
    const withStock = chooseInsight({
        ...quiet,
        outstanding: 450000,
        lowOrOutCount: 3,
        currency: 'NGN',
    });
    assert.match(withStock.body, /3 products are low or out of stock/);
    assert.match(withStock.fingerprint, /stock:3$/);
    assert.equal(chooseInsight({ ...quiet, lowOrOutCount: 4 }), null);
});

test('statement and premium expiry pushes open the right page', () => {
    const statement = buildStatementPush('September 2026');
    assert.equal(statement.title, 'Your statement is ready');
    assert.match(statement.body, /September 2026/);
    assert.equal(statement.url, '/statements');
    assert.equal(statement.tag, 'statement-ready');

    const expiry = buildPremiumExpiryPush('21 October 2026');
    assert.equal(expiry.url, '/upgrade');
    assert.match(expiry.body, /21 October 2026/);
    assert.equal(expiry.tag, 'premium-expiry');
});

test('chooseInsight reports a real change in collected and skips a quiet day', () => {
    const up = chooseInsight({
        ...quiet,
        collected: 80000,
        collectedComparison: { direction: 'up' },
        currency: 'NGN',
    });
    assert.equal(up.title, 'Collected this month');
    assert.match(up.body, /up from last month/);
    assert.equal(chooseInsight(quiet), null);
    assert.equal(chooseInsight({
        ...quiet,
        collected: 80000,
        collectedComparison: { direction: 'flat' },
    }), null);
});

test('shouldSendInsight sends once in the morning and waits three days to repeat', () => {
    const base = {
        localHour: 8,
        localDate: '2026-10-18',
        lastSentLocalDate: null,
        fingerprint: 'outstanding:450000',
        previousFingerprint: null,
        fingerprintLocalDate: null,
    };
    assert.equal(shouldSendInsight(base), true);
    assert.equal(shouldSendInsight({ ...base, localHour: 15 }), false);
    assert.equal(shouldSendInsight({ ...base, lastSentLocalDate: '2026-10-18' }), false);
    assert.equal(shouldSendInsight({
        ...base,
        localDate: '2026-10-19',
        lastSentLocalDate: '2026-10-18',
        previousFingerprint: 'outstanding:450000',
        fingerprintLocalDate: '2026-10-18',
    }), false);
    assert.equal(shouldSendInsight({
        ...base,
        localDate: '2026-10-21',
        lastSentLocalDate: '2026-10-18',
        previousFingerprint: 'outstanding:450000',
        fingerprintLocalDate: '2026-10-18',
    }), true);
    assert.equal(shouldSendInsight({
        ...base,
        localDate: '2026-10-19',
        lastSentLocalDate: '2026-10-18',
        fingerprint: 'overdue:1:1000',
        previousFingerprint: 'outstanding:450000',
        fingerprintLocalDate: '2026-10-18',
    }), true);
});
