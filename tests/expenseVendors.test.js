import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueVendorNames } from '../utils/expenseVendors.js';

test('uniqueVendorNames trims, drops blanks, and de-dupes case-insensitively', () => {
    assert.deepEqual(
        uniqueVendorNames(['  Dangote ', 'dangote', '', 'Landlord', null, '  ']),
        ['Dangote', 'Landlord']
    );
});
