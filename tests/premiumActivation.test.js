import test from 'node:test';
import assert from 'node:assert/strict';
import {
    addCalendarMonths,
    isPremiumUntilInflated,
    nextPaymentDateFromSubscription,
    nextReconciledPremiumUntil,
    premiumUntilFromPaidAt,
} from '../services/premiumActivation.js';

test('addCalendarMonths follows Paystack calendar months', () => {
    const started = new Date('2026-08-27T10:00:00.000Z');
    assert.equal(addCalendarMonths(started, 1).toISOString(), '2026-09-27T10:00:00.000Z');
});

test('premiumUntilFromPaidAt uses calendar months not 30-day blocks', () => {
    const paidAt = new Date('2026-08-27T10:00:00.000Z');
    const until = premiumUntilFromPaidAt(paidAt, 1);
    assert.equal(until.toISOString(), '2026-09-27T10:00:00.000Z');
});

test('isPremiumUntilInflated is false for a single paid period', () => {
    const paidAt = new Date('2026-09-13T10:00:00.000Z');
    const until = premiumUntilFromPaidAt(paidAt, 1);
    assert.equal(isPremiumUntilInflated(until, paidAt, 1), false);
});

test('isPremiumUntilInflated is true when extra periods were stacked', () => {
    const paidAt = new Date('2026-09-13T10:00:00.000Z');
    const inflated = addCalendarMonths(paidAt, 20);
    assert.equal(isPremiumUntilInflated(inflated, paidAt, 1), true);
});

test('nextReconciledPremiumUntil prefers Paystack next_payment_date', () => {
    const now = new Date('2026-09-13T12:00:00.000Z');
    const result = nextReconciledPremiumUntil({
        plan: 'premium',
        premiumUntil: new Date('2026-10-13T12:00:00.000Z'),
        billingInterval: 'monthly',
        paystackSubscriptionCode: 'SUB_123',
        paidAt: new Date('2026-09-13T10:00:00.000Z'),
        months: 1,
        now,
        paystackNextPaymentDate: '2026-09-27T00:00:00.000Z',
    });
    assert.equal(result.changed, true);
    assert.equal(new Date(result.until).toISOString(), '2026-09-27T00:00:00.000Z');
});

test('nextReconciledPremiumUntil does not move a future date into the past', () => {
    const now = new Date('2026-09-13T12:00:00.000Z');
    const future = new Date('2028-07-04T00:00:00.000Z');
    const oldPaidAt = new Date('2026-06-01T10:00:00.000Z');
    const result = nextReconciledPremiumUntil({
        plan: 'premium',
        premiumUntil: future,
        billingInterval: 'monthly',
        paidAt: oldPaidAt,
        months: 1,
        now,
    });
    assert.equal(result.changed, false);
    assert.equal(new Date(result.until).toISOString(), future.toISOString());
});

test('nextReconciledPremiumUntil restores a subscriber expired by a bad clamp', () => {
    const now = new Date('2026-09-13T12:00:00.000Z');
    const expired = new Date('2026-07-01T00:00:00.000Z');
    const result = nextReconciledPremiumUntil({
        plan: 'premium',
        premiumUntil: expired,
        billingInterval: 'monthly',
        paystackSubscriptionCode: 'SUB_123',
        paidAt: new Date('2026-06-01T10:00:00.000Z'),
        months: 1,
        now,
    });
    assert.equal(result.changed, true);
    assert.equal(new Date(result.until).toISOString(), addCalendarMonths(now, 1).toISOString());
});

test('nextReconciledPremiumUntil shrinks stacked dates only when no Paystack subscription is on file', () => {
    const now = new Date('2026-09-13T12:00:00.000Z');
    const paidAt = new Date('2026-09-13T10:00:00.000Z');
    const stacked = new Date('2028-07-04T00:00:00.000Z');
    const expected = premiumUntilFromPaidAt(paidAt, 1);
    const result = nextReconciledPremiumUntil({
        plan: 'premium',
        premiumUntil: stacked,
        billingInterval: 'monthly',
        paidAt,
        months: 1,
        now,
    });
    assert.equal(result.changed, true);
    assert.equal(new Date(result.until).toISOString(), expected.toISOString());
});

test('nextPaymentDateFromSubscription reads Paystack next_payment_date', () => {
    const next = nextPaymentDateFromSubscription({ next_payment_date: '2026-09-27T00:00:00.000Z' });
    assert.equal(next.toISOString(), '2026-09-27T00:00:00.000Z');
});
