import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseAdminUserFilters,
    buildAdminUserFilter,
    buildAdminUserFilterSlug,
} from '../utils/adminUserFilters.js';

test('parseAdminUserFilters accepts google and email sign-in filters', () => {
    assert.equal(parseAdminUserFilters({ auth: 'google' }).auth, 'google');
    assert.equal(parseAdminUserFilters({ auth: 'email' }).auth, 'email');
    assert.equal(parseAdminUserFilters({ auth: 'facebook' }).auth, 'all');
    assert.equal(parseAdminUserFilters({}).auth, 'all');
});

test('buildAdminUserFilterSlug includes sign-in method', () => {
    assert.equal(
        buildAdminUserFilterSlug({ plan: 'all', status: 'all', activity: 'all', auth: 'google' }),
        'google'
    );
    assert.equal(
        buildAdminUserFilterSlug({ plan: 'free', status: 'all', activity: 'all', auth: 'email' }),
        'free-email'
    );
});

test('buildAdminUserFilter matches Google accounts', async () => {
    const filter = await buildAdminUserFilter({
        search: '',
        plan: 'all',
        status: 'all',
        activity: 'all',
        auth: 'google',
    });
    assert.deepEqual(filter, { authProvider: 'google' });
});
