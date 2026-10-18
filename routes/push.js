import express from 'express';
import PushSubscription from '../models/PushSubscription.js';
import auth from '../middleware/auth.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { getVapidPublicKey, isPushConfigured } from '../utils/webPush.js';

const router = express.Router();

function readSubscription(body) {
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
    const p256dh = typeof body?.keys?.p256dh === 'string' ? body.keys.p256dh.trim() : '';
    const authKey = typeof body?.keys?.auth === 'string' ? body.keys.auth.trim() : '';
    if (!endpoint.startsWith('https://') || endpoint.length > 2000) return null;
    if (!p256dh || p256dh.length > 200 || !authKey || authKey.length > 200) return null;
    return { endpoint, p256dh, auth: authKey };
}

router.get('/config', auth, asyncHandler(async (req, res) => {
    res.json({
        configured: isPushConfigured(),
        publicKey: isPushConfigured() ? getVapidPublicKey() : '',
    });
}));

/** Bind this browser to the signed-in user. The same endpoint is moved if the account changes. */
router.post('/subscribe', auth, asyncHandler(async (req, res) => {
    if (!isPushConfigured()) {
        return res.status(503).json({ message: 'Push notifications are not configured.' });
    }
    const subscription = readSubscription(req.body);
    if (!subscription) {
        return res.status(400).json({ message: 'A valid push subscription is required.' });
    }

    await PushSubscription.findOneAndUpdate(
        { endpoint: subscription.endpoint },
        { $set: { userId: req.user.userId, p256dh: subscription.p256dh, auth: subscription.auth } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ ok: true });
}));

router.post('/unsubscribe', auth, asyncHandler(async (req, res) => {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
    if (!endpoint) {
        return res.status(400).json({ message: 'A push endpoint is required.' });
    }
    await PushSubscription.deleteOne({ userId: req.user.userId, endpoint });
    res.json({ ok: true });
}));

export default router;
