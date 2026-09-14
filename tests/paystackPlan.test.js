import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMatchingPlanCode, requirePinnedPlanCode } from '../services/paystackPlan.js';

const monthlyConfig = {
    name: 'Waraqah Premium Monthly',
    interval: 'monthly',
    amountKobo: 500000,
};

test('pickMatchingPlanCode returns the oldest matching plan', () => {
    const code = pickMatchingPlanCode(
        [
            {
                plan_code: 'PLN_newer',
                name: 'Waraqah Premium Monthly',
                amount: 500000,
                interval: 'monthly',
                currency: 'NGN',
                createdAt: '2026-08-09T12:00:00.000Z',
            },
            {
                plan_code: 'PLN_older',
                name: 'Waraqah Premium Monthly',
                amount: 500000,
                interval: 'monthly',
                currency: 'NGN',
                createdAt: '2026-08-09T10:00:00.000Z',
            },
        ],
        monthlyConfig,
    );

    assert.equal(code, 'PLN_older');
});

test('pickMatchingPlanCode ignores plans with different amount or interval', () => {
    const code = pickMatchingPlanCode(
        [
            {
                plan_code: 'PLN_wrong_amount',
                name: 'Waraqah Premium Monthly',
                amount: 200000,
                interval: 'monthly',
                currency: 'NGN',
                createdAt: '2026-08-09T10:00:00.000Z',
            },
            {
                plan_code: 'PLN_wrong_interval',
                name: 'Waraqah Premium Monthly',
                amount: 500000,
                interval: 'annually',
                currency: 'NGN',
                createdAt: '2026-08-09T10:00:00.000Z',
            },
        ],
        monthlyConfig,
    );

    assert.equal(code, null);
});

test('production refuses to create a Paystack plan when env codes are missing', () => {
    const savedNodeEnv = process.env.NODE_ENV;
    const savedMonthly = process.env.PAYSTACK_PLAN_CODE;
    const savedYearly = process.env.PAYSTACK_PLAN_CODE_YEARLY;
    const savedVercel = process.env.VERCEL;
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL;
    delete process.env.PAYSTACK_PLAN_CODE;
    delete process.env.PAYSTACK_PLAN_CODE_YEARLY;

    try {
        assert.throws(
            () => requirePinnedPlanCode('monthly'),
            /PAYSTACK_PLAN_CODE/,
        );
    } finally {
        process.env.NODE_ENV = savedNodeEnv;
        if (savedMonthly == null) delete process.env.PAYSTACK_PLAN_CODE;
        else process.env.PAYSTACK_PLAN_CODE = savedMonthly;
        if (savedYearly == null) delete process.env.PAYSTACK_PLAN_CODE_YEARLY;
        else process.env.PAYSTACK_PLAN_CODE_YEARLY = savedYearly;
        if (savedVercel == null) delete process.env.VERCEL;
        else process.env.VERCEL = savedVercel;
    }
});

test('pickMatchingPlanCode accepts paginated Paystack responses', () => {
    const code = pickMatchingPlanCode(
        {
            data: [
                {
                    plan_code: 'PLN_paged',
                    name: 'Waraqah Premium Monthly',
                    amount: 500000,
                    interval: 'monthly',
                    currency: 'NGN',
                    createdAt: '2026-08-09T10:00:00.000Z',
                },
            ],
        },
        monthlyConfig,
    );

    assert.equal(code, 'PLN_paged');
});
