import webpush from 'web-push';
import PushSubscription from '../models/PushSubscription.js';

let configured = false;
let warned = false;

export function isPushConfigured() {
    return Boolean(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim());
}

export function getVapidPublicKey() {
    return process.env.VAPID_PUBLIC_KEY?.trim() || '';
}

function ensureConfigured() {
    if (!isPushConfigured()) {
        if (!warned) {
            warned = true;
            console.warn('[Waraqah Push] VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not set. Push is off.');
        }
        return false;
    }
    if (!configured) {
        const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:support@mywaraqah.com';
        webpush.setVapidDetails(subject, getVapidPublicKey(), process.env.VAPID_PRIVATE_KEY.trim());
        configured = true;
    }
    return true;
}

export async function sendPushToUser(userId, payload) {
    if (!ensureConfigured()) return { sent: 0, removed: 0 };
    const subscriptions = await PushSubscription.find({ userId }).limit(20).lean();
    return sendPushToSubscriptions(subscriptions, payload);
}

export async function sendPushToSubscriptions(subscriptions, payload) {
    if (!ensureConfigured()) return { sent: 0, removed: 0 };
    const body = JSON.stringify(payload);
    let sent = 0;
    let removed = 0;

    for (const subscription of subscriptions) {
        try {
            await webpush.sendNotification(
                {
                    endpoint: subscription.endpoint,
                    keys: { p256dh: subscription.p256dh, auth: subscription.auth },
                },
                body
            );
            sent += 1;
        } catch (err) {
            const status = err?.statusCode;
            if (status === 404 || status === 410) {
                await PushSubscription.deleteOne({ _id: subscription._id });
                removed += 1;
                continue;
            }
            console.error('[Waraqah Push] Send failed:', {
                userId: subscription.userId,
                status,
                message: err?.message,
            });
        }
    }

    return { sent, removed };
}
