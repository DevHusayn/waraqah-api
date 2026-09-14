import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPremiumGrantedByAdminText } from '../src/emails/senders/premiumGrantedByAdminEmail.js';

test('admin-granted Premium email mentions no payment and the access date', () => {
    const text = buildPremiumGrantedByAdminText({ premiumUntil: '6 October 2026' });
    assert.match(text, /admin has activated Premium/);
    assert.match(text, /Premium until: 6 October 2026/);
    assert.match(text, /No payment was taken/);
});
