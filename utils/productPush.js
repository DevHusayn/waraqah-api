import BusinessInfo from '../models/CompanyInfo.js';
import PushBroadcast from '../models/PushBroadcast.js';
import PushSubscription from '../models/PushSubscription.js';
import User from '../models/User.js';
import { isPushAudience, userMatchesPushAudience } from './pushAudience.js';
import {
    PRODUCT_PUSH_TAG,
    canSendProductPush,
    nextProductPushAt,
    normalizeProductPushLink,
} from './pushInsight.js';
import { isPushConfigured, sendPushToSubscriptions } from './webPush.js';

const BROADCAST_KEY = 'product';

async function loadEligibleSubscriptions({ audience = 'all', userId } = {}) {
    const subscriptions = await PushSubscription.find().lean();
    const userIds = [...new Set(subscriptions.map((subscription) => String(subscription.userId)))];
    if (userIds.length === 0) return [];

    const [users, businesses] = await Promise.all([
        User.find({ _id: { $in: userIds } }).select('_id status lastActiveAt lastLogin').lean(),
        BusinessInfo.find({ userId: { $in: userIds } }).select('userId plan premiumUntil').lean(),
    ]);
    const userById = new Map(users.map((user) => [String(user._id), user]));
    const businessByUserId = new Map(businesses.map((info) => [String(info.userId), info]));

    return subscriptions.filter((subscription) => userMatchesPushAudience(
        userById.get(String(subscription.userId)),
        businessByUserId.get(String(subscription.userId)),
        audience,
        { userId }
    ));
}

export async function getProductPushStatus({ audience = 'all', userId } = {}) {
    const [broadcast, eligible] = await Promise.all([
        PushBroadcast.findOne({ key: BROADCAST_KEY }).lean(),
        loadEligibleSubscriptions({ audience, userId }),
    ]);
    const lastSentAt = broadcast?.lastSentAt || null;
    return {
        configured: isPushConfigured(),
        subscriberCount: eligible.length,
        audience,
        last: lastSentAt
            ? {
                title: broadcast.title,
                body: broadcast.body,
                url: broadcast.url,
                audience: broadcast.audience || 'all',
                sentAt: lastSentAt,
                sentCount: broadcast.sentCount || 0,
            }
            : null,
        nextAllowedAt: canSendProductPush(lastSentAt) ? null : nextProductPushAt(lastSentAt),
    };
}

export function readPushAudience(body = {}) {
    const audience = String(body.audience || 'all');
    if (!isPushAudience(audience)) {
        return { error: 'Choose who should receive this.' };
    }
    const userId = String(body.userId || '').trim();
    if (audience === 'individual' && userId && !/^[a-f\d]{24}$/i.test(userId)) {
        return { error: 'Choose one person to notify.' };
    }
    if (audience === 'individual' && body.requireUser && !/^[a-f\d]{24}$/i.test(userId)) {
        return { error: 'Choose one person to notify.' };
    }
    return { audience, userId: audience === 'individual' ? userId : '' };
}

export function readProductPushInput(body) {
    const title = String(body?.title || '').trim().replace(/\s+/g, ' ');
    const message = String(body?.body || body?.message || '').trim().replace(/\s+/g, ' ');
    const url = normalizeProductPushLink(body?.url);
    if (!title || title.length > 80) {
        return { error: 'Add a title of 80 characters or less.' };
    }
    if (!message || message.length > 140) {
        return { error: 'Add one sentence of 140 characters or less.' };
    }
    if (!url) {
        return { error: 'Use an in-app path or an https link.' };
    }
    const audienceInput = readPushAudience({ ...body, requireUser: true });
    if (audienceInput.error) return audienceInput;
    return { title, body: message, url, ...audienceInput };
}

export async function sendProductPush({ title, body, url, audience = 'all', userId, adminUserId }) {
    if (!isPushConfigured()) {
        const err = new Error('Push notifications are not configured.');
        err.status = 503;
        throw err;
    }

    const eligible = await loadEligibleSubscriptions({ audience, userId });
    if (eligible.length === 0) {
        const err = new Error('No devices in this group have allowed notifications.');
        err.status = 400;
        throw err;
    }

    const existing = await PushBroadcast.findOne({ key: BROADCAST_KEY }).lean();
    if (!canSendProductPush(existing?.lastSentAt)) {
        const err = new Error('A product update was already sent this week.');
        err.status = 429;
        err.nextAllowedAt = nextProductPushAt(existing.lastSentAt);
        throw err;
    }

    const now = new Date();
    let claimed;
    try {
        claimed = await PushBroadcast.findOneAndUpdate(
            { key: BROADCAST_KEY, lastSentAt: existing?.lastSentAt ?? null },
            {
                $set: {
                    title,
                    body,
                    url,
                    audience,
                    lastSentAt: now,
                    sentCount: 0,
                    removedCount: 0,
                    createdBy: adminUserId,
                },
                $setOnInsert: { key: BROADCAST_KEY },
            },
            { upsert: !existing, new: true }
        );
    } catch (err) {
        if (err?.code === 11000) {
            const busy = new Error('A product update was already sent this week.');
            busy.status = 429;
            throw busy;
        }
        throw err;
    }
    if (!claimed) {
        const err = new Error('A product update was already sent this week.');
        err.status = 429;
        throw err;
    }

    const { sent, removed } = await sendPushToSubscriptions(eligible, {
        title,
        body,
        url,
        tag: PRODUCT_PUSH_TAG,
    });

    await PushBroadcast.updateOne(
        { _id: claimed._id },
        { $set: { sentCount: sent, removedCount: removed } }
    );

    return { sent, removed, subscriberCount: eligible.length };
}
