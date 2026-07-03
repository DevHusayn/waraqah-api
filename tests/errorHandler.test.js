import test from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler.js';

function mockRes() {
    const res = {
        headersSent: false,
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
    return res;
}

test('errorHandler returns 400 for validation errors', () => {
    const err = new Error('Bad input');
    err.status = 400;
    const res = mockRes();
    const next = () => {};

    errorHandler(err, {}, res, next);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Bad input');
});

test('errorHandler returns 403 for invoice limit errors', () => {
    const err = new Error('Limit reached');
    err.code = 'INVOICE_LIMIT_REACHED';
    err.usage = { used: 5, limit: 5 };
    const res = mockRes();
    const next = () => {};

    errorHandler(err, {}, res, next);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'INVOICE_LIMIT_REACHED');
    assert.deepEqual(res.body.usage, { used: 5, limit: 5 });
});

test('errorHandler returns custom status codes', () => {
    const err = new Error('Too many requests');
    err.status = 429;
    const res = mockRes();
    const next = () => {};

    errorHandler(err, {}, res, next);

    assert.equal(res.statusCode, 429);
    assert.equal(res.body.message, 'Too many requests');
});

test('errorHandler returns 500 for unknown errors', () => {
    const res = mockRes();
    const next = () => {};
    const originalError = console.error;
    console.error = () => {};

    try {
        errorHandler(new Error('Unexpected'), {}, res, next);
        assert.equal(res.statusCode, 500);
        assert.equal(res.body.message, 'Server error');
    } finally {
        console.error = originalError;
    }
});

test('notFoundHandler returns 404', () => {
    const res = mockRes();

    notFoundHandler({}, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.message, 'Not found');
});
