import test from 'node:test';
import assert from 'node:assert/strict';
import asyncHandler from '../middleware/asyncHandler.js';

function mockReqResNext() {
    const req = {};
    const res = {
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
    let nextArg = null;
    const next = (err) => {
        nextArg = err;
    };
    return { req, res, next, getNextError: () => nextArg };
}

test('asyncHandler resolves successful handlers', async () => {
    const handler = asyncHandler(async (req, res) => {
        res.json({ ok: true });
    });
    const { req, res, next, getNextError } = mockReqResNext();

    await handler(req, res, next);

    assert.equal(getNextError(), null);
    assert.deepEqual(res.body, { ok: true });
});

test('asyncHandler forwards rejected promises to next', async () => {
    const error = new Error('db down');
    const handler = asyncHandler(async () => {
        throw error;
    });
    const { req, res, next, getNextError } = mockReqResNext();

    await handler(req, res, next);

    assert.equal(getNextError(), error);
});

test('asyncHandler forwards sync throws to next', async () => {
    const error = new Error('sync fail');
    const handler = asyncHandler(async () => {
        throw error;
    });
    const { req, res, next, getNextError } = mockReqResNext();

    await handler(req, res, next);

    assert.equal(getNextError(), error);
});
