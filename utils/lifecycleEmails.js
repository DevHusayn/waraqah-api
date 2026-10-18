/** Keep in sync with InvoicePro/packages/shared/src/lifecycleEmails.js */
/** Lifecycle follow-up emails (admin review queue). Email only — never WhatsApp. */

export const LIFECYCLE_TEMPLATE_IDS = Object.freeze([
    'quota-reached',
    'finish-setup',
    'we-miss-you',
]);

export const LIFECYCLE_TEMPLATES = Object.freeze({
    'quota-reached': {
        id: 'quota-reached',
        label: 'Quota reached',
        reason: "Used this month's free invoices and quotations",
    },
    'finish-setup': {
        id: 'finish-setup',
        label: 'Finish setup',
        reason: 'Signed up but has not added clients, products, or documents yet',
    },
    'we-miss-you': {
        id: 'we-miss-you',
        label: 'We miss you',
        reason: 'Has workspace data but has not been active for 30+ days',
    },
});

/** Minimum days between any admin/product email before another lifecycle send. */
export const LIFECYCLE_MIN_DAYS_BETWEEN = 14;
/** Finish setup waits this many days after signup. */
export const LIFECYCLE_FINISH_SETUP_DELAY_DAYS = 2;
/** We miss you after this many days without login or activity. */
export const LIFECYCLE_INACTIVE_DAYS = 30;
export const LIFECYCLE_SNOOZE_DAYS = 7;
/** New queue items the daily job may create in one run. */
export const LIFECYCLE_ENQUEUE_CAP_PER_RUN = 50;
/** User batches scanned per template (50 users each). Stops even if the cap is not filled. */
export const LIFECYCLE_MAX_SCAN_BATCHES = 8;
/** Max emails one bulk-send action may send. */
export const LIFECYCLE_SEND_CAP = 20;

export function isLifecycleTemplateId(templateId) {
    return LIFECYCLE_TEMPLATE_IDS.includes(templateId);
}

export function lifecycleTemplateLabel(templateId) {
    return LIFECYCLE_TEMPLATES[templateId]?.label || templateId || 'Follow-up';
}

export function lifecyclePeriodKey(templateId, now = new Date()) {
    if (templateId === 'quota-reached') {
        const date = now instanceof Date ? now : new Date(now);
        if (Number.isNaN(date.getTime())) return 'once';
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    return 'once';
}

function toDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function nowMs(now) {
    if (typeof now === 'number' && Number.isFinite(now)) return now;
    const date = toDate(now);
    return date ? date.getTime() : Date.now();
}

export function msUntilNextLifecycleEmail(lastSentAt, now = Date.now()) {
    const last = toDate(lastSentAt);
    if (!last) return 0;
    const minMs = LIFECYCLE_MIN_DAYS_BETWEEN * 24 * 60 * 60 * 1000;
    return Math.max(0, minMs - (nowMs(now) - last.getTime()));
}

export function canSendLifecycleEmailNow(lastSentAt, now = Date.now()) {
    return msUntilNextLifecycleEmail(lastSentAt, now) === 0;
}

export function isLifecycleAudience({
    status,
    isAdmin,
    isProtected,
    email,
    emailVerified,
    optedOut,
} = {}) {
    if (status && status !== 'active') return false;
    if (isAdmin) return false;
    if (isProtected) return false;
    if (!String(email || '').trim()) return false;
    if (emailVerified === false) return false;
    if (optedOut) return false;
    return true;
}

export function isInactiveForLifecycle(lastActivityAt, now = Date.now()) {
    const last = toDate(lastActivityAt);
    if (!last) return true;
    const cutoff = LIFECYCLE_INACTIVE_DAYS * 24 * 60 * 60 * 1000;
    return nowMs(now) - last.getTime() >= cutoff;
}

export function shouldExitLifecycleTemplate(templateId, snapshot = {}) {
    if (!isLifecycleAudience(snapshot)) return 'not-audience';
    if (templateId === 'finish-setup') {
        return snapshot.hasWorkspace ? 'has-workspace' : null;
    }
    if (templateId === 'we-miss-you') {
        if (!snapshot.hasWorkspace) return 'empty-workspace';
        if (!isInactiveForLifecycle(snapshot.lastActivityAt, snapshot.now)) return 'active';
        return null;
    }
    if (templateId === 'quota-reached') {
        if (snapshot.isPremium) return 'premium';
        if (!snapshot.quotaReached) return 'quota-open';
        return null;
    }
    return 'unknown-template';
}

function historyHas(list, templateId, periodKey) {
    return (list || []).some(
        (item) => item.templateId === templateId && (item.periodKey || 'once') === periodKey
    );
}

function suppressed(reason) {
    return {
        eligible: false,
        templateId: null,
        periodKey: '',
        reason: '',
        suppressedReason: reason,
    };
}

/**
 * Pick at most one lifecycle template for a user snapshot.
 * Priority: quota-reached, finish-setup, we-miss-you.
 */
export function evaluateLifecycleEligibility(snapshot = {}) {
    const now = toDate(snapshot.now) || new Date();
    if (!isLifecycleAudience(snapshot)) return suppressed('not-audience');
    if (!canSendLifecycleEmailNow(snapshot.lastLifecycleSentAt, now)) {
        return suppressed('cooldown');
    }

    const history = snapshot.history || {};

    for (const templateId of LIFECYCLE_TEMPLATE_IDS) {
        const periodKey = lifecyclePeriodKey(templateId, now);
        if (historyHas(history.sent, templateId, periodKey)) continue;
        if (historyHas(history.skipped, templateId, periodKey)) continue;
        if (historyHas(history.pending, templateId, periodKey)) continue;

        const exit = shouldExitLifecycleTemplate(templateId, { ...snapshot, now });
        if (exit) continue;

        if (templateId === 'finish-setup') {
            const created = toDate(snapshot.createdAt);
            if (!created) continue;
            const delay = LIFECYCLE_FINISH_SETUP_DELAY_DAYS * 24 * 60 * 60 * 1000;
            if (now.getTime() - created.getTime() < delay) continue;
        }

        return {
            eligible: true,
            templateId,
            periodKey,
            reason: LIFECYCLE_TEMPLATES[templateId].reason,
            suppressedReason: '',
        };
    }

    return suppressed('no-match');
}
