import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnv } from '../utils/envValidation.js';

const savedEnv = { ...process.env };

test.afterEach(() => {
    process.env = { ...savedEnv };
});

test('production rejects short JWT_SECRET', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'short';
    process.env.MONGO_URI = 'mongodb+srv://user:pass@cluster.example.net/waraqah';
    process.env.FRONTEND_URL = 'https://mywaraqah.com';
    process.env.ALLOW_DEV_PLAN = 'false';
    process.env.RESEND_API_KEY = 're_test';

    const { errors } = validateEnv();

    assert.ok(errors.some((e) => e.includes('JWT_SECRET')));
});

test('production rejects ALLOW_DEV_PLAN=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.MONGO_URI = 'mongodb+srv://user:pass@cluster.example.net/waraqah';
    process.env.FRONTEND_URL = 'https://mywaraqah.com';
    process.env.ALLOW_DEV_PLAN = 'true';
    process.env.RESEND_API_KEY = 're_test';

    const { errors } = validateEnv();

    assert.ok(errors.some((e) => e.includes('ALLOW_DEV_PLAN')));
});

test('production requires RESEND_API_KEY', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.MONGO_URI = 'mongodb+srv://user:pass@cluster.example.net/waraqah';
    process.env.FRONTEND_URL = 'https://mywaraqah.com';
    process.env.ALLOW_DEV_PLAN = 'false';
    delete process.env.RESEND_API_KEY;

    const { errors } = validateEnv();

    assert.ok(errors.some((e) => e.includes('RESEND_API_KEY')));
});

test('development warns when ALLOW_DEV_PLAN is enabled', () => {
    delete process.env.NODE_ENV;
    delete process.env.VERCEL;
    process.env.ALLOW_DEV_PLAN = 'true';

    const { warnings } = validateEnv();

    assert.ok(warnings.some((w) => w.includes('ALLOW_DEV_PLAN')));
});
