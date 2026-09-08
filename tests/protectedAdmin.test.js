import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getProtectedAdminEmails,
    isProtectedAdminEmail,
    isProtectedAdminUser,
} from '../utils/protectedAdmin.js';

test('owner email is always protected', () => {
    assert.equal(isProtectedAdminEmail('husaynmubarak0@gmail.com'), true);
    assert.equal(isProtectedAdminEmail('  HusaynMubarak0@Gmail.com  '), true);
    assert.equal(isProtectedAdminUser({ email: 'husaynmubarak0@gmail.com' }), true);
});

test('other emails are not protected by default', () => {
    assert.equal(isProtectedAdminEmail('someone@example.com'), false);
    assert.equal(isProtectedAdminEmail(''), false);
    assert.equal(isProtectedAdminUser({}), false);
});

test('PROTECTED_ADMIN_EMAILS adds extra addresses', () => {
    const previous = process.env.PROTECTED_ADMIN_EMAILS;
    process.env.PROTECTED_ADMIN_EMAILS = 'ops@mywaraqah.com, second@example.com';
    try {
        const emails = getProtectedAdminEmails();
        assert.equal(emails.has('husaynmubarak0@gmail.com'), true);
        assert.equal(emails.has('ops@mywaraqah.com'), true);
        assert.equal(isProtectedAdminEmail('second@example.com'), true);
    } finally {
        if (previous === undefined) delete process.env.PROTECTED_ADMIN_EMAILS;
        else process.env.PROTECTED_ADMIN_EMAILS = previous;
    }
});
