import test from 'node:test';
import assert from 'node:assert/strict';
import { todayDateString } from '../utils/invoiceOverdue.js';

test('todayDateString returns YYYY-MM-DD', () => {
    const str = todayDateString(new Date(2026, 6, 3));
    assert.equal(str, '2026-07-03');
});
