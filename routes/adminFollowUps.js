import express from 'express';
import auth from '../middleware/auth.js';
import requireAdmin from '../middleware/requireAdmin.js';
import validateObjectId from '../middleware/validateObjectId.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { adminEmailLimiter } from '../middleware/rateLimits.js';
import AdminFollowUp from '../models/AdminFollowUp.js';
import User from '../models/User.js';
import {
    parsePagination,
    buildPaginationMeta,
    paginateFind,
    escapeRegex,
} from '../utils/pagination.js';
import { isValidObjectId } from '../utils/sanitize.js';
import {
    isLifecycleTemplateId,
    LIFECYCLE_SNOOZE_DAYS,
    LIFECYCLE_SEND_CAP,
} from '../utils/lifecycleEmails.js';
import {
    enqueueLifecycleFollowUps,
    previewFollowUpItem,
    readyPendingFilter,
    sendFollowUpItem,
    serializeFollowUps,
} from '../utils/lifecycleFollowUpService.js';

const router = express.Router();

router.use(auth, requireAdmin);

function parseTemplate(query) {
    const value = String(query?.template || '').trim();
    return isLifecycleTemplateId(value) ? value : 'all';
}

async function findPendingOr404(id) {
    const item = await AdminFollowUp.findById(id);
    if (!item) {
        const err = new Error('Follow-up not found');
        err.status = 404;
        throw err;
    }
    return item;
}

router.get('/', asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req, { defaultLimit: 20 });
    const template = parseTemplate(req.query);
    const search = String(req.query.search || '').trim();
    const now = new Date();
    const filter = { ...readyPendingFilter(now) };
    if (template !== 'all') filter.templateId = template;

    if (search) {
        const regex = new RegExp(escapeRegex(search), 'i');
        const userIds = await User.find({ $or: [{ email: regex }, { name: regex }] }).distinct('_id');
        filter.userId = { $in: userIds.length ? userIds : [null] };
    }

    const { data, total } = await paginateFind(AdminFollowUp, filter, {
        skip,
        limit,
        sort: { createdAt: 1 },
        lean: true,
    });

    res.set('Cache-Control', 'no-store');
    res.json({
        data: await serializeFollowUps(data),
        pagination: buildPaginationMeta(page, limit, total),
    });
}));

router.get('/stats', asyncHandler(async (req, res) => {
    const now = new Date();
    const ready = readyPendingFilter(now);
    const [pending, snoozed, byTemplate] = await Promise.all([
        AdminFollowUp.countDocuments(ready),
        AdminFollowUp.countDocuments({
            status: 'pending',
            snoozeUntil: { $gt: now },
        }),
        AdminFollowUp.aggregate([
            { $match: ready },
            { $group: { _id: '$templateId', count: { $sum: 1 } } },
        ]),
    ]);
    const counts = { 'quota-reached': 0, 'finish-setup': 0, 'we-miss-you': 0 };
    for (const row of byTemplate) {
        if (row._id in counts) counts[row._id] = row.count;
    }
    res.set('Cache-Control', 'no-store');
    res.json({ pending, snoozed, templates: counts });
}));

router.post('/refresh', asyncHandler(async (req, res) => {
    const result = await enqueueLifecycleFollowUps();
    res.json({
        message: 'Follow-up queue updated.',
        enqueued: result.enqueued,
        cancelled: result.cancelled,
    });
}));

router.post('/send-bulk', adminEmailLimiter, asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    const unique = [...new Set(ids.filter(isValidObjectId))];
    if (!unique.length) {
        const err = new Error('Select at least one follow-up.');
        err.status = 400;
        throw err;
    }
    if (unique.length > LIFECYCLE_SEND_CAP) {
        const err = new Error(`Send at most ${LIFECYCLE_SEND_CAP} follow-ups at a time.`);
        err.status = 400;
        throw err;
    }

    const sent = [];
    const failed = [];
    for (const id of unique) {
        try {
            const item = await AdminFollowUp.findById(id);
            if (!item) {
                failed.push({ id, message: 'Follow-up not found' });
                continue;
            }
            const result = await sendFollowUpItem(item, req.user.userId);
            sent.push({ id, to: result.to });
        } catch (err) {
            failed.push({ id, message: err.message || 'Could not send.' });
        }
    }

    res.json({
        message: sent.length
            ? `Sent ${sent.length} follow-up${sent.length === 1 ? '' : 's'}.`
            : 'No follow-ups were sent.',
        sent,
        failed,
    });
}));

router.get('/:id/preview', validateObjectId(), asyncHandler(async (req, res) => {
    const item = await findPendingOr404(req.params.id);
    const preview = await previewFollowUpItem(item);
    res.json(preview);
}));

router.post('/:id/send', validateObjectId(), adminEmailLimiter, asyncHandler(async (req, res) => {
    const item = await findPendingOr404(req.params.id);
    const result = await sendFollowUpItem(item, req.user.userId);
    res.json({
        message: `Email sent to ${result.to}`,
        to: result.to,
        subject: result.subject,
    });
}));

router.post('/:id/skip', validateObjectId(), asyncHandler(async (req, res) => {
    const item = await findPendingOr404(req.params.id);
    if (item.status !== 'pending') {
        const err = new Error('This follow-up is no longer pending.');
        err.status = 409;
        throw err;
    }
    item.status = 'skipped';
    item.skippedAt = new Date();
    item.actorId = req.user.userId;
    item.exitReason = 'skipped';
    await item.save();
    res.json({ message: 'Follow-up skipped.' });
}));

router.post('/:id/snooze', validateObjectId(), asyncHandler(async (req, res) => {
    const item = await findPendingOr404(req.params.id);
    if (item.status !== 'pending') {
        const err = new Error('This follow-up is no longer pending.');
        err.status = 409;
        throw err;
    }
    const until = new Date(Date.now() + LIFECYCLE_SNOOZE_DAYS * 24 * 60 * 60 * 1000);
    item.snoozeUntil = until;
    item.actorId = req.user.userId;
    await item.save();
    res.json({
        message: `Snoozed for ${LIFECYCLE_SNOOZE_DAYS} days.`,
        snoozeUntil: until,
    });
}));

router.post('/:id/mute', validateObjectId(), asyncHandler(async (req, res) => {
    const item = await findPendingOr404(req.params.id);
    const now = new Date();
    if (item.status === 'pending') {
        item.status = 'skipped';
        item.skippedAt = now;
        item.exitReason = 'muted';
        item.actorId = req.user.userId;
        await item.save();
    }
    await User.updateOne(
        { _id: item.userId },
        { $set: { lifecycleFollowUpsOptOut: true } }
    );
    await AdminFollowUp.updateMany(
        { userId: item.userId, status: 'pending', _id: { $ne: item._id } },
        { $set: { status: 'cancelled', cancelledAt: now, exitReason: 'muted' } }
    );
    res.json({ message: 'This user will not be queued for follow-ups.' });
}));

router.patch('/users/:userId/opt-out', validateObjectId('userId'), asyncHandler(async (req, res) => {
    const optedOut = Boolean(req.body?.optedOut);
    const user = await User.findById(req.params.userId);
    if (!user) {
        const err = new Error('User not found');
        err.status = 404;
        throw err;
    }
    user.lifecycleFollowUpsOptOut = optedOut;
    await user.save();
    if (optedOut) {
        await AdminFollowUp.updateMany(
            { userId: user._id, status: 'pending' },
            { $set: { status: 'cancelled', cancelledAt: new Date(), exitReason: 'muted' } }
        );
    }
    res.json({
        message: optedOut
            ? 'This user will not be queued for follow-ups.'
            : 'Follow-ups can be queued for this user again.',
        optedOut,
    });
}));

export default router;
