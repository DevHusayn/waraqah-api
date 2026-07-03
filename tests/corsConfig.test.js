import test from 'node:test';
import assert from 'node:assert/strict';
import { isOriginAllowed, getAllowedOrigins } from '../utils/corsConfig.js';

const savedEnv = { ...process.env };

test.afterEach(() => {
    process.env = { ...savedEnv };
});

test('getAllowedOrigins includes FRONTEND_URL and ALLOWED_ORIGINS', () => {
    process.env.FRONTEND_URL = 'https://mywaraqah.com/';
    process.env.ALLOWED_ORIGINS = 'https://www.mywaraqah.com, https://admin.mywaraqah.com';

    const origins = getAllowedOrigins();

    assert.deepEqual(origins, [
        'https://mywaraqah.com',
        'https://www.mywaraqah.com',
        'https://admin.mywaraqah.com',
    ]);
});

test('isOriginAllowed accepts configured frontend URL', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';

    assert.equal(isOriginAllowed('https://app.example.com'), true);
    assert.equal(isOriginAllowed('https://evil.example.com'), false);
});

test('isOriginAllowed accepts vercel.app previews when enabled', () => {
    process.env.FRONTEND_URL = 'https://mywaraqah.com';
    process.env.CORS_ALLOW_VERCEL = 'true';

    assert.equal(isOriginAllowed('https://waraqah-git-main-dev.vercel.app'), true);
    assert.equal(isOriginAllowed('https://malicious.example.com'), false);
});

test('isOriginAllowed allows missing origin (same-origin / server requests)', () => {
    assert.equal(isOriginAllowed(null), true);
    assert.equal(isOriginAllowed(undefined), true);
});
