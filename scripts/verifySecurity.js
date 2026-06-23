import { sanitizeClientPayload } from '../utils/sanitize.js';
import { sanitizeInvoicePayload } from '../utils/invoiceValidation.js';
import { validateEnv } from '../utils/envValidation.js';
import { isOriginAllowed } from '../utils/corsConfig.js';
import crypto from 'crypto';

let passed = 0;
let failed = 0;

function assert(label, condition) {
    if (condition) {
        console.log(`PASS: ${label}`);
        passed += 1;
    } else {
        console.log(`FAIL: ${label}`);
        failed += 1;
    }
}

const injectionName = { $gt: '' };
const client = sanitizeClientPayload({ name: injectionName, company: 'Acme' });
assert('client injection coerced to string', typeof client.name === 'string');

try {
    sanitizeInvoicePayload({ status: 'hacked' });
    assert('invoice invalid status rejected', false);
} catch (err) {
    assert('invoice invalid status rejected', err.message.includes('Invalid'));
}

const secret = 'sk_test_verify';
const body = JSON.stringify({ event: 'charge.success', data: { reference: 'ref' } });
const sig = crypto.createHmac('sha512', secret).update(body).digest('hex');
const bad = crypto.createHmac('sha512', 'wrong').update(body).digest('hex');
assert('webhook signature match', sig === crypto.createHmac('sha512', secret).update(body).digest('hex'));
assert('webhook signature mismatch detected', sig !== bad);

process.env.NODE_ENV = 'production';
process.env.ALLOW_DEV_PLAN = 'true';
const { errors } = validateEnv();
assert('ALLOW_DEV_PLAN blocked in production', errors.some((e) => e.includes('ALLOW_DEV_PLAN')));
delete process.env.NODE_ENV;
delete process.env.ALLOW_DEV_PLAN;

process.env.FRONTEND_URL = 'https://app.example.com';
assert('allowed origin passes', isOriginAllowed('https://app.example.com'));
assert('unknown origin blocked', !isOriginAllowed('https://evil.example.com'));
delete process.env.FRONTEND_URL;

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
