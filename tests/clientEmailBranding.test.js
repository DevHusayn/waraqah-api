import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    getClientEmailFromAddress,
    parseDataUrlImage,
    resolveClientReplyTo,
    resolveEmailLogoUrl,
} from '../src/emails/helpers/clientEmailBranding.js';

function withClientFrom(value, fn) {
    const previous = process.env.EMAIL_CLIENT_FROM;
    if (value === undefined) delete process.env.EMAIL_CLIENT_FROM;
    else process.env.EMAIL_CLIENT_FROM = value;
    try {
        return fn();
    } finally {
        if (previous === undefined) delete process.env.EMAIL_CLIENT_FROM;
        else process.env.EMAIL_CLIENT_FROM = previous;
    }
}

test('getClientEmailFromAddress uses invoices mailbox and business name', () => {
    withClientFrom(undefined, () => {
        assert.equal(
            getClientEmailFromAddress('HMA Group'),
            '"HMA Group" <invoices@mail.mywaraqah.com>',
        );
    });
});

test('getClientEmailFromAddress honors EMAIL_CLIENT_FROM and verifies domain', () => {
    withClientFrom('billing@mywaraqah.com', () => {
        assert.equal(
            getClientEmailFromAddress('HMA Group'),
            '"HMA Group" <billing@mail.mywaraqah.com>',
        );
    });
});

test('resolveClientReplyTo returns a valid business email', () => {
    assert.equal(resolveClientReplyTo({ email: '  Owner@HMA.COM ' }), 'owner@hma.com');
    assert.equal(resolveClientReplyTo({ email: 'not-an-email' }), undefined);
    assert.equal(resolveClientReplyTo({}), undefined);
});

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
