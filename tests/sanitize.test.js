import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
    sanitizeClientPayload,
    sanitizePlainText,
    sanitizeEmail,
    isValidObjectId,
    sanitizeStaffPayload,
    sanitizeStaffUpdates,
} from '../utils/sanitize.js';
import { isValidPaystackSignature } from '../services/paystackVerify.js';

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

test('sanitizeStaffPayload requires name, role, and a positive salary', () => {
    const payload = sanitizeStaffPayload({
        name: '  Adaeze  ',
        role: ' Designer ',
        salary: '150000.456',
    });

    assert.equal(payload.name, 'Adaeze');
    assert.equal(payload.role, 'Designer');
    assert.equal(payload.salary, 150000.46);
    assert.equal(payload.isActive, true);
});

test('sanitizeStaffPayload rejects a missing role or non-positive salary', () => {
    assert.throws(
        () => sanitizeStaffPayload({ name: 'Ada', role: '', salary: 10 }),
        (err) => err.status === 400
    );
    assert.throws(
        () => sanitizeStaffPayload({ name: 'Ada', role: 'Driver', salary: 0 }),
        (err) => err.status === 400 && /Salary/.test(err.message)
    );
});

test('sanitizeStaffUpdates only includes provided fields', () => {
    const updates = sanitizeStaffUpdates({ salary: 90, isActive: false });
    assert.deepEqual(updates, { salary: 90, isActive: false });
});

test('paystack webhook signature verification', () => {
    const secret = 'sk_test_verify';
    const body = JSON.stringify({ event: 'charge.success', data: { reference: 'ref' } });
    const sig = crypto.createHmac('sha512', secret).update(body).digest('hex');
    const bad = crypto.createHmac('sha512', 'wrong').update(body).digest('hex');

    assert.equal(isValidPaystackSignature(body, sig, secret), true);
    assert.equal(isValidPaystackSignature(body, bad, secret), false);
});
