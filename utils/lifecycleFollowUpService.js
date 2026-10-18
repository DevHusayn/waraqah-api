import User from '../models/User.js';
import BusinessInfo from '../models/CompanyInfo.js';
import Invoice from '../models/Invoice.js';
import Quotation from '../models/Quotation.js';
import Client from '../models/Client.js';
import Product from '../models/Product.js';
import AdminFollowUp from '../models/AdminFollowUp.js';
import UserActivityLog from '../models/UserActivityLog.js';
import MonthlyInvoiceUsage from '../models/MonthlyInvoiceUsage.js';
import { isProtectedAdminUser } from './protectedAdmin.js';
import { isPremiumActive } from './businessInfoHelpers.js';
import { adminDisplayName } from './adminDisplayName.js';
import {
    getCurrentMonthRange,
    getInvoiceUsageMapForUsers,
    FREE_MONTHLY_INVOICE_LIMIT,
} from './invoiceLimits.js';
import {
    canSendLifecycleEmailNow,
    evaluateLifecycleEligibility,
    shouldExitLifecycleTemplate,
    LIFECYCLE_ENQUEUE_CAP_PER_RUN,
    LIFECYCLE_FINISH_SETUP_DELAY_DAYS,
    LIFECYCLE_INACTIVE_DAYS,
    LIFECYCLE_MAX_SCAN_BATCHES,
    LIFECYCLE_SNOOZE_DAYS,
    LIFECYCLE_SEND_CAP,
    LIFECYCLE_TEMPLATE_IDS,
    lifecycleTemplateLabel,
} from './lifecycleEmails.js';
import {
    applyAdminMessageTemplate,
    parseAdminMessageInput,
    resolveAdminMessageGreeting,
} from '../src/emails/helpers/adminMessage.js';
import {
    renderAdminMessageEmail,
    sendAdminMessageEmail,
    getEmailErrorMessage,
} from '../src/emails/index.js';
import { logAdminEmailSent } from './userActivityLog.js';

const BATCH_SIZE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export { LIFECYCLE_SNOOZE_DAYS, LIFECYCLE_SEND_CAP };

export function lastActivityAt(user) {
    const login = user?.lastLogin ? new Date(user.lastLogin).getTime() : 0;
    const active = user?.lastActiveAt ? new Date(user.lastActiveAt).getTime() : 0;
    const max = Math.max(login, active);
    return max ? new Date(max) : null;
}

async function workspaceFlagMap(userIds) {
    const map = new Map(userIds.map((id) => [String(id), false]));
    if (!userIds.length) return map;
    const [invoices, quotations, clients, products] = await Promise.all([
        Invoice.distinct('userId', { userId: { $in: userIds } }),
        Quotation.distinct('userId', { userId: { $in: userIds } }),
        Client.distinct('userId', { userId: { $in: userIds } }),
        Product.distinct('userId', { userId: { $in: userIds } }),
    ]);
    for (const id of [...invoices, ...quotations, ...clients, ...products]) {
        if (id) map.set(String(id), true);
    }
    return map;
}

export async function loadFollowUpHistory(userIds) {
    const empty = () => ({ sent: [], skipped: [], pending: [], lastEmailAt: null });
    const byUser = new Map(userIds.map((id) => [String(id), empty()]));
    if (!userIds.length) return byUser;

    const [items, emails] = await Promise.all([
        AdminFollowUp.find({ userId: { $in: userIds } })
            .select('userId templateId periodKey status')
            .lean(),
        UserActivityLog.find({
            userId: { $in: userIds },
            type: 'admin_email_sent',
        })
            .select('userId createdAt meta.templateId')
            .sort({ createdAt: -1 })
            .lean(),
    ]);

    for (const item of items) {
        const row = byUser.get(String(item.userId));
        if (!row) continue;
        const entry = { templateId: item.templateId, periodKey: item.periodKey || 'once' };
        if (item.status === 'pending') row.pending.push(entry);
        else if (item.status === 'sent') row.sent.push(entry);
        else if (item.status === 'skipped') row.skipped.push(entry);
    }

    for (const log of emails) {
        const row = byUser.get(String(log.userId));
        if (!row) continue;
        if (!row.lastEmailAt) row.lastEmailAt = log.createdAt;
        const templateId = log.meta?.templateId;
        if (LIFECYCLE_TEMPLATE_IDS.includes(templateId)) {
            const already = row.sent.some((entry) => entry.templateId === templateId);
            if (!already) {
                row.sent.push({
                    templateId,
                    periodKey: templateId === 'quota-reached' ? 'unknown' : 'once',
                });
            }
        }
    }

    return byUser;
}

export async function buildSnapshotsForUsers(users, now = new Date(), options = {}) {
    const userIds = users.map((user) => user._id);
    const loadUsage = options.loadUsage !== false;
    const knownWorkspace = options.hasWorkspace;
    const [workspaceMap, usageMap, historyMap, businesses] = await Promise.all([
        knownWorkspace === undefined ? workspaceFlagMap(userIds) : Promise.resolve(null),
        loadUsage ? getInvoiceUsageMapForUsers(userIds) : Promise.resolve(new Map()),
        loadFollowUpHistory(userIds),
        BusinessInfo.find({ userId: { $in: userIds } }).select('userId plan premiumUntil name').lean(),
    ]);
    const businessByUser = new Map(businesses.map((row) => [String(row.userId), row]));

    return users.map((user) => {
        const id = String(user._id);
        const usage = usageMap.get(id);
        const history = historyMap.get(id) || { sent: [], skipped: [], pending: [], lastEmailAt: null };
        const business = businessByUser.get(id);
        return {
            user,
            business,
            snapshot: {
                status: user.status,
                isAdmin: Boolean(user.isAdmin),
                isProtected: isProtectedAdminUser(user),
                email: user.email,
                emailVerified: user.emailVerified === undefined ? true : Boolean(user.emailVerified),
                optedOut: Boolean(user.lifecycleFollowUpsOptOut),
                createdAt: user.createdAt,
                lastActivityAt: lastActivityAt(user),
                hasWorkspace: knownWorkspace !== undefined
                    ? Boolean(knownWorkspace)
                    : Boolean(workspaceMap.get(id)),
                isPremium: isPremiumActive(business),
                quotaReached: Boolean(
                    loadUsage
                    && usage
                    && !usage.unlimited
                    && usage.used >= (usage.limit || FREE_MONTHLY_INVOICE_LIMIT)
                ),
                lastLifecycleSentAt: history.lastEmailAt,
                history: {
                    sent: history.sent,
                    skipped: history.skipped,
                    pending: history.pending,
                },
                now,
            },
        };
    });
}

async function cancelIfStale(item, snapshot, now) {
    const exit = shouldExitLifecycleTemplate(item.templateId, { ...snapshot, now });
    if (!exit) return false;
    item.status = 'cancelled';
    item.cancelledAt = now;
    item.exitReason = exit;
    await item.save();
    return true;
}

export async function cancelStaleFollowUps(now = new Date()) {
    let cancelled = 0;
    let lastId = null;

    while (true) {
        const filter = { status: 'pending' };
        if (lastId) filter._id = { $gt: lastId };
        const batch = await AdminFollowUp.find(filter).sort({ _id: 1 }).limit(BATCH_SIZE);
        if (!batch.length) break;
        lastId = batch[batch.length - 1]._id;

        const users = await User.find({ _id: { $in: batch.map((item) => item.userId) } }).lean();
        const userById = new Map(users.map((user) => [String(user._id), user]));
        const present = users.length ? await buildSnapshotsForUsers(users, now) : [];
        const snapshotByUser = new Map(present.map((row) => [String(row.user._id), row.snapshot]));

        for (const item of batch) {
            const snapshot = snapshotByUser.get(String(item.userId));
            if (!snapshot) {
                if (!userById.has(String(item.userId))) {
                    item.status = 'cancelled';
                    item.cancelledAt = now;
                    item.exitReason = 'missing-user';
                    await item.save();
                    cancelled += 1;
                }
                continue;
            }
            if (await cancelIfStale(item, snapshot, now)) cancelled += 1;
        }

        if (batch.length < BATCH_SIZE) break;
    }

    return cancelled;
}

async function enqueueForUsers(users, now, remaining, snapshotOptions = {}) {
    if (!users.length || remaining <= 0) return 0;
    const rows = await buildSnapshotsForUsers(users, now, snapshotOptions);
    let created = 0;
    for (const row of rows) {
        if (created >= remaining) break;
        const result = evaluateLifecycleEligibility(row.snapshot);
        if (!result.eligible) continue;
        try {
            await AdminFollowUp.create({
                userId: row.user._id,
                templateId: result.templateId,
                periodKey: result.periodKey,
                status: 'pending',
                reason: result.reason,
                source: 'queue',
            });
            created += 1;
        } catch (err) {
            if (err?.code === 11000) continue;
            throw err;
        }
    }
    return created;
}

const AUDIENCE_FILTER = {
    status: 'active',
    isAdmin: { $ne: true },
    lifecycleFollowUpsOptOut: { $ne: true },
    email: { $exists: true, $nin: [null, ''] },
    emailVerified: { $ne: false },
};

const USER_SCAN_FIELDS = 'email name status isAdmin lastLogin lastActiveAt createdAt emailVerified lifecycleFollowUpsOptOut';

async function scanUsers(extraFilter, now, remaining, snapshotOptions = {}) {
    let created = 0;
    let lastId = null;
    let batches = 0;
    const base = { ...AUDIENCE_FILTER, ...extraFilter };

    while (created < remaining && batches < LIFECYCLE_MAX_SCAN_BATCHES) {
        const filter = { ...base };
        if (lastId) {
            const existing = filter._id && typeof filter._id === 'object' ? { ...filter._id } : {};
            filter._id = { ...existing, $gt: lastId };
        }
        const batch = await User.find(filter)
            .select(USER_SCAN_FIELDS)
            .sort({ _id: 1 })
            .limit(BATCH_SIZE)
            .lean();
        if (!batch.length) break;
        lastId = batch[batch.length - 1]._id;
        batches += 1;
        created += await enqueueForUsers(batch, now, remaining - created, snapshotOptions);
        if (batch.length < BATCH_SIZE) break;
    }
    return created;
}

async function workspaceUserIds() {
    const [invoices, quotations, clients, products] = await Promise.all([
        Invoice.distinct('userId'),
        Quotation.distinct('userId'),
        Client.distinct('userId'),
        Product.distinct('userId'),
    ]);
    const seen = new Set();
    const ids = [];
    for (const id of [...invoices, ...quotations, ...clients, ...products]) {
        if (!id) continue;
        const key = String(id);
        if (seen.has(key)) continue;
        seen.add(key);
        ids.push(id);
    }
    return ids;
}

async function quotaCandidateUserIds() {
    const { periodKey } = getCurrentMonthRange();
    return MonthlyInvoiceUsage.find({
        periodKey,
        count: { $gte: FREE_MONTHLY_INVOICE_LIMIT },
    }).distinct('userId');
}

async function excludeUserIds(filter) {
    return AdminFollowUp.distinct('userId', filter);
}

function inactiveFilter(now) {
    const cutoff = new Date(now.getTime() - LIFECYCLE_INACTIVE_DAYS * DAY_MS);
    return {
        $and: [
            {
                $or: [
                    { lastActiveAt: { $exists: false } },
                    { lastActiveAt: null },
                    { lastActiveAt: { $lt: cutoff } },
                ],
            },
            {
                $or: [
                    { lastLogin: { $exists: false } },
                    { lastLogin: null },
                    { lastLogin: { $lt: cutoff } },
                ],
            },
        ],
    };
}

/** Daily job: drop stale queue rows, then enqueue eligible users. Does not send. */
export async function enqueueLifecycleFollowUps(now = new Date()) {
    const cancelled = await cancelStaleFollowUps(now);
    let enqueued = 0;
    const cap = LIFECYCLE_ENQUEUE_CAP_PER_RUN;

    const [workspaceIds, pendingUserIds, usedFinishIds, usedMissIds, usedQuotaIds, quotaIds] = await Promise.all([
        workspaceUserIds(),
        excludeUserIds({ status: 'pending' }),
        excludeUserIds({ templateId: 'finish-setup', periodKey: 'once', status: { $in: ['sent', 'skipped', 'pending'] } }),
        excludeUserIds({ templateId: 'we-miss-you', periodKey: 'once', status: { $in: ['sent', 'skipped', 'pending'] } }),
        excludeUserIds({
            templateId: 'quota-reached',
            periodKey: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
            status: { $in: ['sent', 'skipped', 'pending'] },
        }),
        quotaCandidateUserIds(),
    ]);

    const pendingSet = new Set(pendingUserIds.map(String));

    if (quotaIds.length && enqueued < cap) {
        const skip = new Set([...pendingSet, ...usedQuotaIds.map(String)]);
        const users = await User.find({
            ...AUDIENCE_FILTER,
            _id: { $in: quotaIds.filter((id) => !skip.has(String(id))) },
        })
            .select(USER_SCAN_FIELDS)
            .limit(BATCH_SIZE * LIFECYCLE_MAX_SCAN_BATCHES)
            .lean();
        enqueued += await enqueueForUsers(users, now, cap - enqueued, {
            hasWorkspace: true,
            loadUsage: true,
        });
    }

    if (enqueued < cap) {
        const delayCutoff = new Date(now.getTime() - LIFECYCLE_FINISH_SETUP_DELAY_DAYS * DAY_MS);
        const skipIds = [...new Set([...workspaceIds, ...pendingUserIds, ...usedFinishIds])];
        enqueued += await scanUsers(
            {
                createdAt: { $lte: delayCutoff },
                ...(skipIds.length ? { _id: { $nin: skipIds } } : {}),
            },
            now,
            cap - enqueued,
            { hasWorkspace: false, loadUsage: false }
        );
    }

    if (enqueued < cap && workspaceIds.length) {
        const skip = new Set([...pendingSet, ...usedMissIds.map(String)]);
        const candidateIds = workspaceIds.filter((id) => !skip.has(String(id)));
        if (candidateIds.length) {
            enqueued += await scanUsers(
                {
                    _id: { $in: candidateIds },
                    ...inactiveFilter(now),
                },
                now,
                cap - enqueued,
                { hasWorkspace: true, loadUsage: false }
            );
        }
    }

    return { enqueued, cancelled };
}

function firstNameFrom(user, business) {
    const greeting = resolveAdminMessageGreeting({
        userName: user?.name,
        businessName: business?.name,
    });
    return String(greeting || '').trim().split(/\s+/)[0] || 'there';
}

export async function buildFollowUpPayload(item, user, business) {
    const filled = applyAdminMessageTemplate(item.templateId, {
        firstName: firstNameFrom(user, business),
    });
    return parseAdminMessageInput({
        subject: filled.subject,
        preview: filled.preview,
        body: filled.body,
        fromPreset: 'support',
        fromName: '',
        actionPreset: filled.actionPreset,
        actionLabel: filled.actionLabel,
    });
}

export async function previewFollowUpItem(item) {
    const user = await User.findById(item.userId).select('name email').lean();
    if (!user) {
        const err = new Error('User not found');
        err.status = 404;
        throw err;
    }
    if (!user.email) {
        const err = new Error('This user does not have an email address.');
        err.status = 400;
        throw err;
    }
    const business = await BusinessInfo.findOne({ userId: user._id }).select('name').lean();
    const payload = await buildFollowUpPayload(item, user, business);
    const greetingName = resolveAdminMessageGreeting({
        userName: user.name,
        businessName: business?.name,
    });
    const rendered = await renderAdminMessageEmail({
        userName: greetingName,
        preview: payload.preview,
        body: payload.body,
        noReply: false,
        actionUrl: payload.actionUrl,
        actionLabel: payload.actionLabel,
    });
    return {
        html: rendered.html,
        text: rendered.text,
        subject: payload.subject,
        preview: payload.preview,
        from: payload.from,
        replyTo: payload.replyTo || null,
        to: user.email,
        actionUrl: payload.actionUrl || '',
        actionLabel: payload.actionLabel || '',
        templateId: item.templateId,
        templateLabel: lifecycleTemplateLabel(item.templateId),
    };
}

export async function sendFollowUpItem(item, actorId, now = new Date()) {
    if (item.status !== 'pending') {
        const err = new Error('This follow-up is no longer pending.');
        err.status = 409;
        throw err;
    }
    if (item.snoozeUntil && new Date(item.snoozeUntil) > now) {
        const err = new Error('This follow-up is snoozed.');
        err.status = 409;
        throw err;
    }

    const user = await User.findById(item.userId).lean();
    if (!user) {
        item.status = 'cancelled';
        item.cancelledAt = now;
        item.exitReason = 'missing-user';
        await item.save();
        const err = new Error('User not found');
        err.status = 404;
        throw err;
    }

    const [row] = await buildSnapshotsForUsers([user], now);
    if (await cancelIfStale(item, row.snapshot, now)) {
        const err = new Error('This user is no longer eligible for that follow-up.');
        err.status = 409;
        throw err;
    }
    if (!canSendLifecycleEmailNow(row.snapshot.lastLifecycleSentAt, now)) {
        const err = new Error('This user received an email recently. Wait before sending another follow-up.');
        err.status = 409;
        throw err;
    }

    if (!user.email) {
        const err = new Error('This user does not have an email address.');
        err.status = 400;
        throw err;
    }

    const payload = await buildFollowUpPayload(item, user, row.business);
    const greetingName = resolveAdminMessageGreeting({
        userName: user.name,
        businessName: row.business?.name,
    });

    try {
        await sendAdminMessageEmail({
            to: user.email,
            userName: greetingName,
            subject: payload.subject,
            preview: payload.preview,
            body: payload.body,
            from: payload.from,
            replyTo: payload.replyTo,
            fromPreset: 'support',
            actionUrl: payload.actionUrl,
            actionLabel: payload.actionLabel,
        });
    } catch (mailErr) {
        const err = new Error(getEmailErrorMessage(mailErr));
        err.status = 503;
        throw err;
    }

    await logAdminEmailSent(user._id, actorId, {
        subject: payload.subject,
        preview: payload.preview,
        body: payload.body,
        from: payload.from,
        replyTo: payload.replyTo,
        fromName: '',
        fromPreset: 'support',
        to: user.email,
        actionPreset: payload.actionPreset,
        actionLabel: payload.actionLabel,
        actionUrl: payload.actionUrl,
        templateId: item.templateId,
        source: 'queue',
    });

    item.status = 'sent';
    item.sentAt = now;
    item.actorId = actorId || null;
    item.snoozeUntil = null;
    await item.save();

    return { to: user.email, subject: payload.subject };
}

export function readyPendingFilter(now = new Date()) {
    return {
        status: 'pending',
        $or: [{ snoozeUntil: null }, { snoozeUntil: { $lte: now } }],
    };
}

export async function serializeFollowUps(items) {
    const userIds = [...new Set(items.map((item) => String(item.userId)))];
    const [users, businesses, lastEmails] = await Promise.all([
        User.find({ _id: { $in: userIds } })
            .select('name email lastLogin lastActiveAt createdAt status')
            .lean(),
        BusinessInfo.find({ userId: { $in: userIds } }).select('userId name plan premiumUntil').lean(),
        UserActivityLog.aggregate([
            { $match: { userId: { $in: userIds }, type: 'admin_email_sent' } },
            { $sort: { createdAt: -1 } },
            { $group: { _id: '$userId', createdAt: { $first: '$createdAt' } } },
        ]),
    ]);
    const userById = new Map(users.map((user) => [String(user._id), user]));
    const businessById = new Map(businesses.map((row) => [String(row.userId), row]));
    const lastEmailById = new Map(lastEmails.map((row) => [String(row._id), row.createdAt]));

    return items.map((item) => {
        const user = userById.get(String(item.userId));
        const business = businessById.get(String(item.userId));
        return {
            id: String(item._id),
            templateId: item.templateId,
            templateLabel: lifecycleTemplateLabel(item.templateId),
            reason: item.reason || '',
            periodKey: item.periodKey,
            status: item.status,
            snoozeUntil: item.snoozeUntil || null,
            createdAt: item.createdAt,
            lastEmailAt: lastEmailById.get(String(item.userId)) || null,
            user: user
                ? {
                    id: String(user._id),
                    email: user.email,
                    name: user.name || '',
                    displayName: adminDisplayName(user, business),
                    lastLogin: user.lastLogin || null,
                    lastActiveAt: user.lastActiveAt || null,
                    createdAt: user.createdAt,
                    plan: isPremiumActive(business) ? 'premium' : 'free',
                }
                : null,
        };
    });
}
