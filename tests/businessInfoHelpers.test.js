import test from 'node:test';
import assert from 'node:assert/strict';
import { pickAllowedBusinessUpdates, toBusinessInfoResponse } from '../utils/businessInfoHelpers.js';

test('pickAllowedBusinessUpdates persists a valid defaultCurrency and country', () => {
    const updates = pickAllowedBusinessUpdates({
        name: 'Acme',
        country: 'gh',
        defaultCurrency: 'usd',
    });
    assert.equal(updates.country, 'GH');
    assert.equal(updates.defaultCurrency, 'USD');
    assert.equal(updates.name, 'Acme');
});

test('pickAllowedBusinessUpdates does not pin currency to NGN when omitted', () => {
    const updates = pickAllowedBusinessUpdates({ name: 'Acme' });
    assert.equal(updates.defaultCurrency, undefined);
    assert.equal(updates.country, undefined);
});

test('pickAllowedBusinessUpdates rejects invalid currency', () => {
    assert.throws(
        () => pickAllowedBusinessUpdates({ defaultCurrency: 'XXX' }),
        (err) => err.status === 400 && /currency/i.test(err.message)
    );
});

test('pickAllowedBusinessUpdates rejects invalid country', () => {
    assert.throws(
        () => pickAllowedBusinessUpdates({ country: 'XX' }),
        (err) => err.status === 400 && /country/i.test(err.message)
    );
});

test('toBusinessInfoResponse returns stored country and currency', () => {
    const response = toBusinessInfoResponse({
        name: 'Acme',
        country: 'GH',
        defaultCurrency: 'GHS',
        timezone: 'Africa/Accra',
        plan: 'free',
    });
    assert.equal(response.country, 'GH');
    assert.equal(response.defaultCurrency, 'GHS');
});

test('toBusinessInfoResponse defaults missing country and currency to Nigeria / Naira', () => {
    const response = toBusinessInfoResponse({ name: 'Acme', plan: 'free' });
    assert.equal(response.country, 'NG');
    assert.equal(response.defaultCurrency, 'NGN');
});

test('pickAllowedBusinessUpdates saves defaultDocumentFooter for premium', () => {
    const updates = pickAllowedBusinessUpdates(
        { defaultDocumentFooter: '  Pay with thanks.  ' },
        { premium: true }
    );
    assert.equal(updates.defaultDocumentFooter, 'Pay with thanks.');
});

test('pickAllowedBusinessUpdates ignores defaultDocumentFooter for free plans', () => {
    const updates = pickAllowedBusinessUpdates(
        { defaultDocumentFooter: 'Pay with thanks.', brandColor: '#111111' },
        { premium: false }
    );
    assert.equal(updates.defaultDocumentFooter, undefined);
});

test('toBusinessInfoResponse hides defaultDocumentFooter for free plans', () => {
    const hidden = toBusinessInfoResponse({
        name: 'Acme',
        plan: 'free',
        defaultDocumentFooter: 'Pay with thanks.',
    });
    assert.equal(hidden.defaultDocumentFooter, '');

    const shown = toBusinessInfoResponse({
        name: 'Acme',
        plan: 'premium',
        defaultDocumentFooter: 'Pay with thanks.',
    });
    assert.equal(shown.defaultDocumentFooter, 'Pay with thanks.');
});
