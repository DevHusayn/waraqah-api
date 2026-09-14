import crypto from 'crypto';
import { getBillingConfig, normalizeBillingInterval } from './paystack.js';

export class PaystackChargeMismatchError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PaystackChargeMismatchError';
        this.statusCode = 400;
    }
}

export function isValidPaystackSignature(rawBody, signature, secret) {
    if (!secret || !signature || rawBody == null) return false;
    const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    const actual = String(signature);
    const expectedBuf = Buffer.from(expected, 'utf8');
    const actualBuf = Buffer.from(actual, 'utf8');
    if (expectedBuf.length !== actualBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

/** Plan amount in kobo — not the card total when the customer pays Paystack's fee. */
export function chargePlanAmountKobo(paystackData) {
    const requested = Number(paystackData?.requested_amount);
    if (Number.isFinite(requested) && requested > 0) return requested;

    const paidAmount = Number(paystackData?.amount);
    const fees = Number(paystackData?.fees);
    if (Number.isFinite(paidAmount) && Number.isFinite(fees) && fees >= 0) {
        return paidAmount - fees;
    }

    return Number.isFinite(paidAmount) ? paidAmount : NaN;
}

export function chargeMatchesExpected(paystackData, { amount, currency = 'NGN' } = {}) {
    if (!paystackData) return false;
    const expectedAmount = Number(amount);
    const planAmount = chargePlanAmountKobo(paystackData);
    const paidAmount = Number(paystackData.amount);
    if (!Number.isFinite(planAmount) || !Number.isFinite(expectedAmount)) return false;

    const paidCurrency = String(paystackData.currency || 'NGN').toUpperCase();
    if (paidCurrency !== String(currency || 'NGN').toUpperCase()) return false;

    if (planAmount === expectedAmount) return true;

    // Card total can be plan + fee when requested_amount/fees are missing.
    const maxFeeKobo = Math.max(Math.round(expectedAmount * 0.05), 20000);
    return Number.isFinite(paidAmount)
        && paidAmount >= expectedAmount
        && paidAmount <= expectedAmount + maxFeeKobo;
}

export function assertChargeMatchesPayment(paystackData, payment) {
    if (String(paystackData?.status || '').toLowerCase() !== 'success') {
        throw new PaystackChargeMismatchError('Paystack charge is not successful');
    }
    if (!chargeMatchesExpected(paystackData, {
        amount: payment.amount,
        currency: payment.currency || 'NGN',
    })) {
        throw new PaystackChargeMismatchError('Paystack amount or currency does not match this checkout');
    }
}

export function assertChargeMatchesInterval(paystackData, billingInterval) {
    const config = getBillingConfig(normalizeBillingInterval(billingInterval));
    if (String(paystackData?.status || '').toLowerCase() !== 'success') {
        throw new PaystackChargeMismatchError('Paystack charge is not successful');
    }
    if (!chargeMatchesExpected(paystackData, {
        amount: config.amountKobo,
        currency: 'NGN',
    })) {
        throw new PaystackChargeMismatchError('Paystack amount or currency does not match this plan');
    }
}
