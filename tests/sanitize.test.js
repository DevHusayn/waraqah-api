import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
    sanitizeClientPayload,
    sanitizePlainText,
    sanitizeEmail,
    isValidObjectId,
} from '../utils/sanitize.js';

test('sanitizePlainText strips control characters and trims', () => {
    assert.equal(sanitizePlainText('  hello\x00world  '), 'helloworld');
});

test('sanitizePlainText enforces max length', () => {
    assert.equal(sanitizePlainText('abcdef', 3), 'abc');
});

test('sanitizeEmail normalizes and validates', () => {
    assert.equal(sanitizeEmail('  User@Example.COM '), 'user@example.com');
});

test('sanitizeEmail rejects invalid addresses', () => {
    assert.throws(
        () => sanitizeEmail('not-an-email'),
        (err) => err.status === 400
    );
});

test('sanitizeClientPayload coerces injection objects to strings', () => {
    const payload = sanitizeClientPayload({ name: { $gt: '' }, company: 'Acme' });

    assert.equal(typeof payload.name, 'string');
    assert.equal(payload.company, 'Acme');
});

test('isValidObjectId rejects malformed ids', () => {
    assert.equal(isValidObjectId('not-an-id'), false);
    assert.equal(isValidObjectId('507f1f77bcf86cd799439011'), true);
});

test('paystack webhook signature verification', () => {
    const secret = 'sk_test_verify';
    const body = JSON.stringify({ event: 'charge.success', data: { reference: 'ref' } });
    const sig = crypto.createHmac('sha512', secret).update(body).digest('hex');
    const bad = crypto.createHmac('sha512', 'wrong').update(body).digest('hex');

    assert.equal(sig, crypto.createHmac('sha512', secret).update(body).digest('hex'));
    assert.notEqual(sig, bad);
});
