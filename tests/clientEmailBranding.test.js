import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveEmailLogoUrl, parseDataUrlImage } from '../src/emails/helpers/clientEmailBranding.js';

test('resolveEmailLogoUrl maps data URLs to hosted public logo endpoint', () => {
    process.env.API_URL = 'https://api.example.com/api';
    const url = resolveEmailLogoUrl('data:image/png;base64,abc', 'token-123');
    assert.equal(url, 'https://api.example.com/api/public/invoices/token-123/logo');
});

test('resolveEmailLogoUrl keeps https URLs unchanged', () => {
    const url = resolveEmailLogoUrl('https://cdn.example.com/logo.png', 'token-123');
    assert.equal(url, 'https://cdn.example.com/logo.png');
});

test('resolveEmailLogoUrl rejects data URLs without public token', () => {
    assert.equal(resolveEmailLogoUrl('data:image/png;base64,abc', null), null);
});

test('parseDataUrlImage decodes png data URLs', () => {
    const parsed = parseDataUrlImage('data:image/png;base64,aGVsbG8=');
    assert.equal(parsed.mime, 'image/png');
    assert.equal(parsed.buffer.toString(), 'hello');
});
