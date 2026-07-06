import test from 'node:test';
import assert from 'node:assert/strict';

test('getTokenFromRequest prefers Bearer token over session cookie', async () => {
    const { getTokenFromRequest } = await import('../utils/authCookie.js');

    const req = {
        cookies: { waraqah_session: 'cookie-token' },
        headers: { authorization: 'Bearer bearer-token' },
    };

    assert.equal(getTokenFromRequest(req), 'bearer-token');
});

test('getTokenFromRequest falls back to session cookie when Bearer is absent', async () => {
    const { getTokenFromRequest } = await import('../utils/authCookie.js');

    const req = {
        cookies: { waraqah_session: 'cookie-token' },
        headers: {},
    };

    assert.equal(getTokenFromRequest(req), 'cookie-token');
});

test('getTokenFromRequest returns null when no credentials are present', async () => {
    const { getTokenFromRequest } = await import('../utils/authCookie.js');

    assert.equal(getTokenFromRequest({ cookies: {}, headers: {} }), null);
});
