import express from 'express';
import auth from '../middleware/auth.js';
import requireAdmin from '../middleware/requireAdmin.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { getProductPushStatus, readProductPushInput, readPushAudience, sendProductPush } from '../utils/productPush.js';

const router = express.Router();

router.use(auth, requireAdmin);

router.get('/', asyncHandler(async (req, res) => {
    const audienceInput = readPushAudience({
        audience: req.query.audience,
        userId: req.query.userId,
    });
    if (audienceInput.error) {
        return res.status(400).json({ message: audienceInput.error });
    }
    res.json(await getProductPushStatus(audienceInput));
}));

router.post('/', asyncHandler(async (req, res) => {
    const input = readProductPushInput(req.body);
    if (input.error) {
        return res.status(400).json({ message: input.error });
    }
    try {
        const result = await sendProductPush({ ...input, adminUserId: req.user.userId });
        res.json({ ok: true, ...result });
    } catch (err) {
        const status = err.status || 500;
        if (status >= 500) throw err;
        res.status(status).json({
            message: err.message,
            nextAllowedAt: err.nextAllowedAt || null,
        });
    }
}));

export default router;
