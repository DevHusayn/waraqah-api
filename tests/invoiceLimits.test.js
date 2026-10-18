import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFreeQuotaCountStart } from '../utils/invoiceLimits.js';
import { activePremiumQuery, isPremiumActive } from '../utils/businessInfoHelpers.js';

const monthStart = new Date('2026-10-01T00:00:00.000Z');
const now = new Date('2026-10-18T12:00:00.000Z');

test('free quota ignores documents created before a mid-month premium end', () => {
    const premiumUntil = new Date('2026-10-17T06:07:00.000Z');
    const start = resolveFreeQuotaCountStart(monthStart, { premiumUntil, now });
    assert.equal(start.toISOString(), premiumUntil.toISOString());
});

test('free quota keeps the month start when premium ended before this month', () => {
    const start = resolveFreeQuotaCountStart(monthStart, {
        premiumUntil: new Date('2026-09-17T06:07:00.000Z'),
        now,
    });
    assert.equal(start.toISOString(), monthStart.toISOString());
});

test('an admin reset after premium ended starts the free window at the reset', () => {
    const resetAfter = new Date('2026-10-18T08:00:00.000Z');
    const start = resolveFreeQuotaCountStart(monthStart, {
        resetAfter,
        premiumUntil: new Date('2026-10-17T06:07:00.000Z'),
        now,
    });
    assert.equal(start.toISOString(), resetAfter.toISOString());
});

test('a stored premium plan is inactive once premiumUntil has passed', () => {
    assert.equal(
        isPremiumActive(
            { plan: 'premium', premiumUntil: new Date('2026-10-17T06:07:00.000Z') },
            now
        ),
        false
    );
    assert.equal(
        isPremiumActive(
            { plan: 'premium', premiumUntil: new Date('2026-11-17T06:07:00.000Z') },
            now
        ),
        true
    );
    assert.equal(isPremiumActive({ plan: 'premium', premiumUntil: null }, now), true);
});

test('active premium query requires a future end date or no end date', () => {
    assert.deepEqual(activePremiumQuery(now), {
        plan: 'premium',
        $or: [{ premiumUntil: null }, { premiumUntil: { $gt: now } }],
    });
});
