import test from 'node:test';
import assert from 'node:assert/strict';
import {
    canSendLifecycleEmailNow,
    evaluateLifecycleEligibility,
    isInactiveForLifecycle,
    isLifecycleAudience,
    LIFECYCLE_FINISH_SETUP_DELAY_DAYS,
    LIFECYCLE_INACTIVE_DAYS,
    LIFECYCLE_MIN_DAYS_BETWEEN,
    lifecyclePeriodKey,
    msUntilNextLifecycleEmail,
    shouldExitLifecycleTemplate,
} from '../utils/lifecycleEmails.js';

const NOW = new Date('2026-10-18T12:00:00.000Z');

function daysAgo(days) {
    return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function audience(overrides = {}) {
    return {
        status: 'active',
        isAdmin: false,
        isProtected: false,
        email: 'ada@example.com',
        emailVerified: true,
        optedOut: false,
        createdAt: daysAgo(10),
        lastActivityAt: daysAgo(1),
        hasWorkspace: false,
        isPremium: false,
        quotaReached: false,
        lastLifecycleSentAt: null,
        history: { sent: [], skipped: [], pending: [] },
        now: NOW,
        ...overrides,
    };
}

test('lifecyclePeriodKey uses UTC month for quota and once for others', () => {
    assert.equal(lifecyclePeriodKey('quota-reached', NOW), '2026-10');
    assert.equal(lifecyclePeriodKey('finish-setup', NOW), 'once');
    assert.equal(lifecyclePeriodKey('we-miss-you', NOW), 'once');
});

test('canSendLifecycleEmailNow allows first send and blocks inside cooldown', () => {
    assert.equal(canSendLifecycleEmailNow(null, NOW), true);
    assert.equal(canSendLifecycleEmailNow(daysAgo(1), NOW), false);
    assert.equal(canSendLifecycleEmailNow(daysAgo(LIFECYCLE_MIN_DAYS_BETWEEN), NOW), true);
});

test('msUntilNextLifecycleEmail returns remaining wait', () => {
    const last = daysAgo(2);
    const remaining = (LIFECYCLE_MIN_DAYS_BETWEEN - 2) * 24 * 60 * 60 * 1000;
    assert.equal(msUntilNextLifecycleEmail(last, NOW), remaining);
});

test('isLifecycleAudience rejects admins, suspended, protected, blank email, unverified, opted out', () => {
    assert.equal(isLifecycleAudience(audience()), true);
    assert.equal(isLifecycleAudience(audience({ isAdmin: true })), false);
    assert.equal(isLifecycleAudience(audience({ status: 'suspended' })), false);
    assert.equal(isLifecycleAudience(audience({ isProtected: true })), false);
    assert.equal(isLifecycleAudience(audience({ email: '  ' })), false);
    assert.equal(isLifecycleAudience(audience({ emailVerified: false })), false);
    assert.equal(isLifecycleAudience(audience({ optedOut: true })), false);
});

test('isInactiveForLifecycle treats missing activity as inactive', () => {
    assert.equal(isInactiveForLifecycle(null, NOW), true);
    assert.equal(isInactiveForLifecycle(daysAgo(LIFECYCLE_INACTIVE_DAYS), NOW), true);
    assert.equal(isInactiveForLifecycle(daysAgo(LIFECYCLE_INACTIVE_DAYS - 1), NOW), false);
});

test('finish setup is eligible after delay when workspace is empty', () => {
    const result = evaluateLifecycleEligibility(audience({
        createdAt: daysAgo(LIFECYCLE_FINISH_SETUP_DELAY_DAYS),
        hasWorkspace: false,
    }));
    assert.equal(result.eligible, true);
    assert.equal(result.templateId, 'finish-setup');
    assert.equal(result.periodKey, 'once');
});

test('finish setup waits until delay has passed', () => {
    const result = evaluateLifecycleEligibility(audience({
        createdAt: daysAgo(LIFECYCLE_FINISH_SETUP_DELAY_DAYS - 1),
        hasWorkspace: false,
    }));
    assert.equal(result.eligible, false);
    assert.equal(result.suppressedReason, 'no-match');
});

test('quota reached wins over inactivity', () => {
    const result = evaluateLifecycleEligibility(audience({
        hasWorkspace: true,
        quotaReached: true,
        lastActivityAt: daysAgo(40),
    }));
    assert.equal(result.eligible, true);
    assert.equal(result.templateId, 'quota-reached');
    assert.equal(result.periodKey, '2026-10');
});

test('we miss you requires workspace data and 30 days inactive', () => {
    const result = evaluateLifecycleEligibility(audience({
        hasWorkspace: true,
        lastActivityAt: daysAgo(30),
    }));
    assert.equal(result.eligible, true);
    assert.equal(result.templateId, 'we-miss-you');
});

test('already-sent template is not offered again in the same period', () => {
    const result = evaluateLifecycleEligibility(audience({
        hasWorkspace: false,
        createdAt: daysAgo(10),
        history: {
            sent: [{ templateId: 'finish-setup', periodKey: 'once' }],
            skipped: [],
            pending: [],
        },
    }));
    assert.equal(result.eligible, false);
    assert.equal(result.suppressedReason, 'no-match');
});

test('skipped finish-setup is not re-queued', () => {
    const result = evaluateLifecycleEligibility(audience({
        hasWorkspace: false,
        createdAt: daysAgo(10),
        history: {
            sent: [],
            skipped: [{ templateId: 'finish-setup', periodKey: 'once' }],
            pending: [],
        },
    }));
    assert.equal(result.eligible, false);
});

test('pending item blocks a duplicate enqueue', () => {
    const result = evaluateLifecycleEligibility(audience({
        quotaReached: true,
        hasWorkspace: true,
        history: {
            sent: [],
            skipped: [],
            pending: [{ templateId: 'quota-reached', periodKey: '2026-10' }],
        },
    }));
    assert.equal(result.eligible, false);
    assert.equal(result.suppressedReason, 'no-match');
});

test('cooldown suppresses every template', () => {
    const result = evaluateLifecycleEligibility(audience({
        quotaReached: true,
        hasWorkspace: true,
        lastLifecycleSentAt: daysAgo(3),
    }));
    assert.equal(result.eligible, false);
    assert.equal(result.suppressedReason, 'cooldown');
});

test('shouldExitLifecycleTemplate drops finish-setup once they have data', () => {
    assert.equal(shouldExitLifecycleTemplate('finish-setup', audience({ hasWorkspace: true })), 'has-workspace');
    assert.equal(shouldExitLifecycleTemplate('we-miss-you', audience({ hasWorkspace: true, lastActivityAt: daysAgo(1) })), 'active');
    assert.equal(shouldExitLifecycleTemplate('quota-reached', audience({ isPremium: true, quotaReached: true })), 'premium');
});

test('quota can be offered again next month after a send', () => {
    const result = evaluateLifecycleEligibility(audience({
        quotaReached: true,
        hasWorkspace: true,
        history: {
            sent: [{ templateId: 'quota-reached', periodKey: '2026-09' }],
            skipped: [],
            pending: [],
        },
    }));
    assert.equal(result.eligible, true);
    assert.equal(result.templateId, 'quota-reached');
    assert.equal(result.periodKey, '2026-10');
});
