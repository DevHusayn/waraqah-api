
import express from 'express';
import BusinessInfo from '../models/CompanyInfo.js';
import auth from '../middleware/auth.js';
import asyncHandler from '../middleware/asyncHandler.js';
import {
    pickAllowedBusinessUpdates,
    toBusinessInfoResponse,
    toBusinessAssetResponse,
    applyPremiumLogoRules,
    defaultBusinessInfoFields,
    isPremiumActive,
    PLANS,
} from '../utils/businessInfoHelpers.js';
import { isProduction } from '../utils/envValidation.js';

const router = express.Router();

async function getOrCreateBusinessInfo(userId) {
    let info = await BusinessInfo.findOne({ userId });
    if (!info) {
        info = await BusinessInfo.create({ userId, ...defaultBusinessInfoFields });
    }
    return info;
}

// Premium branding assets (large base64 payloads) — load separately from summary.
router.get('/assets', auth, asyncHandler(async (req, res) => {
    const info = await getOrCreateBusinessInfo(req.user.userId);
    res.json(toBusinessAssetResponse(info));
}));

// Get business info for user (?summary=1 omits heavy asset fields)
router.get('/', auth, asyncHandler(async (req, res) => {
    const info = await getOrCreateBusinessInfo(req.user.userId);
    const summary = req.query.summary === '1' || req.query.summary === 'true';
    res.json(toBusinessInfoResponse(info, { includeAssets: !summary }));
}));

// Update business info (plan cannot be changed here — admin/billing only)
router.put('/', auth, asyncHandler(async (req, res) => {
    const existing = await getOrCreateBusinessInfo(req.user.userId);
    const allowDevPlan = !isProduction() && process.env.ALLOW_DEV_PLAN === 'true';
    const updates = pickAllowedBusinessUpdates(req.body, {
        allowPlan: allowDevPlan,
        premium: isPremiumActive(existing),
    });
    if (allowDevPlan && updates.plan !== undefined) {
        if (updates.plan === PLANS.PREMIUM) {
            updates.premiumUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        } else {
            updates.premiumUntil = null;
            updates.businessLogo = '';
            updates.companyLogoUrl = '';
            updates.companyStampUrl = '';
            updates.authorizedSignatureUrl = '';
        }
    }
    applyPremiumLogoRules(updates, existing);

    const info = await BusinessInfo.findOneAndUpdate(
        { userId: req.user.userId },
        { $set: updates },
        { new: true, upsert: true }
    );
    res.json(toBusinessInfoResponse(info));
}));

export default router;
