import test from 'node:test';
import assert from 'node:assert/strict';
import {
    canSendProductPush,
    normalizeProductPushLink,
    PRODUCT_PUSH_MIN_GAP_MS,
} from '../utils/pushInsight.js';
import { readProductPushInput } from '../utils/productPush.js';
import { userMatchesPushAudience } from '../utils/pushAudience.js';

test('product updates can be sent again after a week', () => {
    const now = new Date('2026-10-18T12:00:00Z');
    assert.equal(canSendProductPush(null, now), true);
    assert.equal(canSendProductPush(new Date(now.getTime() - PRODUCT_PUSH_MIN_GAP_MS + 1000), now), false);
    assert.equal(canSendProductPush(new Date(now.getTime() - PRODUCT_PUSH_MIN_GAP_MS), now), true);
});

test('product update links stay on a path or https', () => {
    assert.equal(normalizeProductPushLink(''), '/');
    assert.equal(normalizeProductPushLink('/upgrade'), '/upgrade');
    assert.equal(normalizeProductPushLink('https://mywaraqah.com/changelog'), 'https://mywaraqah.com/changelog');
    assert.equal(normalizeProductPushLink('http://example.com'), null);
    assert.equal(normalizeProductPushLink('//evil.example'), null);
});

test('product update copy is one short title and sentence', () => {
    const ok = readProductPushInput({
        title: 'New in Waraqah',
        body: 'Statements now include partial payments.',
        url: '/statements',
    });
    assert.equal(ok.title, 'New in Waraqah');
    assert.equal(readProductPushInput({ title: '', body: 'Hello', url: '/' }).error != null, true);
    assert.equal(readProductPushInput({
        title: 'New',
        body: 'x'.repeat(141),
        url: '/',
    }).error != null, true);
    assert.equal(readProductPushInput({
        title: 'New',
        body: 'Hello',
        url: '/',
        audience: 'individual',
    }).error != null, true);
});

test('push audience matches plan, activity, and one person', () => {
    const now = new Date('2026-10-18T12:00:00Z');
    const recent = new Date('2026-10-16T12:00:00Z');
    const stale = new Date('2026-08-01T12:00:00Z');
    const premium = { plan: 'premium', premiumUntil: new Date('2027-01-01T00:00:00Z') };
    const freeUser = { _id: 'a'.repeat(24), status: 'active', lastActiveAt: recent };
    const premiumUser = { _id: 'b'.repeat(24), status: 'active', lastActiveAt: stale };
    const quietUser = { _id: 'c'.repeat(24), status: 'active', lastLogin: stale, lastActiveAt: stale };
    const suspended = { _id: 'd'.repeat(24), status: 'suspended', lastActiveAt: recent };

    assert.equal(userMatchesPushAudience(freeUser, null, 'all', { now }), true);
    assert.equal(userMatchesPushAudience(suspended, null, 'all', { now }), false);
    assert.equal(userMatchesPushAudience(premiumUser, premium, 'premium', { now }), true);
    assert.equal(userMatchesPushAudience(freeUser, null, 'free', { now }), true);
    assert.equal(userMatchesPushAudience(freeUser, null, 'active', { now }), true);
    assert.equal(userMatchesPushAudience(quietUser, null, 'inactive', { now }), true);
    assert.equal(userMatchesPushAudience(freeUser, null, 'inactive', { now }), false);
    assert.equal(userMatchesPushAudience(premiumUser, premium, 'individual', { userId: premiumUser._id, now }), true);
    assert.equal(userMatchesPushAudience(freeUser, null, 'individual', { userId: premiumUser._id, now }), false);
});
