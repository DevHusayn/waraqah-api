import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isValidCountryCode,
    isValidCurrencyCode,
    normalizeCountry,
    normalizeCurrency,
} from '../utils/locale.js';

test('isValidCurrencyCode accepts cash ISO codes and rejects test codes', () => {
    assert.equal(isValidCurrencyCode('NGN'), true);
    assert.equal(isValidCurrencyCode('usd'), true);
    assert.equal(isValidCurrencyCode('JPY'), true);
    assert.equal(isValidCurrencyCode('XXX'), false);
    assert.equal(isValidCurrencyCode('NG'), false);
});

test('normalizeCurrency falls back to NGN', () => {
    assert.equal(normalizeCurrency('ghs'), 'GHS');
    assert.equal(normalizeCurrency('XXX'), 'NGN');
    assert.equal(normalizeCurrency(''), 'NGN');
});

test('country codes validate via Intl region names', () => {
    assert.equal(isValidCountryCode('NG'), true);
    assert.equal(isValidCountryCode('GH'), true);
    assert.equal(isValidCountryCode('US'), true);
    assert.equal(isValidCountryCode('XX'), false);
    assert.equal(normalizeCountry('gh'), 'GH');
    assert.equal(normalizeCountry('XX'), 'NG');
});
