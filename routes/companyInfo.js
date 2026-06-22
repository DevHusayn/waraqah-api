
import express from 'express';
import BusinessInfo from '../models/CompanyInfo.js';
import auth from '../middleware/auth.js';
import {
    pickAllowedBusinessUpdates,
    toBusinessInfoResponse,
    applyPremiumLogoRules,
    defaultBusinessInfoFields,
    isPremiumActive,
    PLANS,
} from '../utils/businessInfoHelpers.js';

const router = express.Router();

async function getOrCreateBusinessInfo(userId) {
    let info = await BusinessInfo.findOne({ userId });
    if (!info) {
        info = await BusinessInfo.create({ userId, ...defaultBusinessInfoFields });
    }
    return info;
}

// Get business info for user
router.get('/', auth, async (req, res) => {
    try {
        const info = await getOrCreateBusinessInfo(req.user.userId);
        res.json(toBusinessInfoResponse(info));
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// Update business info (plan cannot be changed here — admin/billing only)
router.put('/', auth, async (req, res) => {
    try {
        const existing = await getOrCreateBusinessInfo(req.user.userId);
        const allowDevPlan = process.env.ALLOW_DEV_PLAN === 'true';
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
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

export default router;
