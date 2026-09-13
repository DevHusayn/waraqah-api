import test from 'node:test';
import assert from 'node:assert/strict';
import {
    needsSubscriptionLink,
    pickLatestActiveSubscription,
    subscriptionMetaFromCharge,
} from '../services/paystackSubscriptionLink.js';

test('subscriptionMetaFromCharge reads nested subscription fields', () => {
    const meta = subscriptionMetaFromCharge({
        subscription: {
            subscription_code: 'SUB_123',
            email_token: 'token_abc',
        },
        customer: {
            customer_code: 'CUS_456',
        },
    });

    assert.equal(meta.subscriptionCode, 'SUB_123');
    assert.equal(meta.customerCode, 'CUS_456');
    assert.equal(meta.emailToken, 'token_abc');
});

test('subscriptionMetaFromCharge reads subscription.create payload shape', () => {
    const meta = subscriptionMetaFromCharge({
        subscription_code: 'SUB_789',
        email_token: 'token_xyz',
        customer: { customer_code: 'CUS_999' },
    });

    assert.equal(meta.subscriptionCode, 'SUB_789');
    assert.equal(meta.customerCode, 'CUS_999');
    assert.equal(meta.emailToken, 'token_xyz');
});

test('pickLatestActiveSubscription prefers the matching billing interval', () => {
    const match = pickLatestActiveSubscription(
        [
            {
                subscription_code: 'SUB_YEARLY',
                status: 'active',
                plan: { interval: 'annually' },
                updatedAt: '2026-09-13T12:00:00.000Z',
            },
            {
                subscription_code: 'SUB_MONTHLY',
                status: 'active',
                plan: { interval: 'monthly' },
                updatedAt: '2026-09-13T11:00:00.000Z',
            },
        ],
        'monthly',
    );

    assert.equal(match?.subscription_code, 'SUB_MONTHLY');
});

test('needsSubscriptionLink is true when subscription code or status is missing', () => {
    assert.equal(needsSubscriptionLink(null), true);
    assert.equal(needsSubscriptionLink({ paystackSubscriptionCode: '', subscriptionStatus: null }), true);
    assert.equal(
        needsSubscriptionLink({ paystackSubscriptionCode: 'SUB_123', subscriptionStatus: null }),
        true,
    );
    assert.equal(
        needsSubscriptionLink({ paystackSubscriptionCode: 'SUB_123', subscriptionStatus: 'active' }),
        false,
    );
});
