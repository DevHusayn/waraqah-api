import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
    PaystackChargeMismatchError,
    assertChargeMatchesPayment,
    chargeMatchesExpected,
    isValidPaystackSignature,
} from '../services/paystackVerify.js';

test('Paystack webhook signatures use a timing-safe compare', () => {
    const secret = 'sk_test_verify';
    const body = JSON.stringify({ event: 'charge.success', data: { reference: 'ref' } });
    const sig = crypto.createHmac('sha512', secret).update(body).digest('hex');

    assert.equal(isValidPaystackSignature(body, sig, secret), true);
    assert.equal(isValidPaystackSignature(body, 'abc', secret), false);
    assert.equal(isValidPaystackSignature(body, sig, 'wrong'), false);
    assert.equal(isValidPaystackSignature(body, '', secret), false);
});

test('Paystack charges must match the checkout amount and currency', () => {
    const payment = { amount: 500000, currency: 'NGN' };
    assert.equal(chargeMatchesExpected({ amount: 500000, currency: 'NGN' }, payment), true);
    assert.equal(chargeMatchesExpected({ amount: 5000000, currency: 'NGN' }, payment), false);
    assert.equal(chargeMatchesExpected({ amount: 500000, currency: 'USD' }, payment), false);

    assert.throws(
        () => assertChargeMatchesPayment({ status: 'success', amount: 50000, currency: 'NGN' }, payment),
        PaystackChargeMismatchError,
    );
    assert.doesNotThrow(() => assertChargeMatchesPayment({
        status: 'success',
        amount: 500000,
        currency: 'NGN',
    }, payment));
});

test('Paystack charges still match when the customer pays the fee', () => {
    const payment = { amount: 500000, currency: 'NGN' };
    assert.equal(chargeMatchesExpected({
        amount: 517500,
        requested_amount: 500000,
        fees: 17500,
        currency: 'NGN',
    }, payment), true);
    assert.equal(chargeMatchesExpected({
        amount: 517500,
        fees: 17500,
        currency: 'NGN',
    }, payment), true);
    assert.equal(chargeMatchesExpected({
        amount: 5000000,
        requested_amount: 5000000,
        fees: 75000,
        currency: 'NGN',
    }, payment), false);
});
