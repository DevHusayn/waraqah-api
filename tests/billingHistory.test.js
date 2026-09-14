import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ABANDONED_CHECKOUT_MS,
    billingHistoryQuery,
    isAbandonedPending,
} from '../services/billingHistory.js';

test('billing history lists paid charges only', () => {
    assert.deepEqual(billingHistoryQuery('user-1'), { userId: 'user-1', status: 'success' });
});

test('pending checkout is abandoned after one hour', () => {
    const now = new Date('2026-09-14T12:00:00.000Z');
    assert.equal(
        isAbandonedPending({ status: 'pending', createdAt: '2026-09-14T10:59:00.000Z' }, now),
        true,
    );
    assert.equal(
        isAbandonedPending({ status: 'pending', createdAt: '2026-09-14T11:30:00.000Z' }, now),
        false,
    );
    assert.equal(
        isAbandonedPending({ status: 'success', createdAt: '2026-09-14T10:00:00.000Z' }, now),
        false,
    );
    assert.equal(ABANDONED_CHECKOUT_MS, 60 * 60 * 1000);
});
