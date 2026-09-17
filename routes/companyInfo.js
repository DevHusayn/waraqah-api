
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
import { optimizeBusinessAsset } from '../utils/imageOptimize.js';
import { invalidateDashboardCache } from '../utils/dashboardStats.js';
import { reconcilePremiumUntilForUser } from '../services/premiumActivation.js';
import { persistBusinessCurrencyChange, userHasBooksAmounts } from '../utils/booksCurrencyRebase.js';
import { isValidExchangeRate, roundExchangeRate } from '../utils/documentCurrency.js';
import { normalizeCurrency } from '../utils/locale.js';

async function toBusinessInfoClientResponse(userId, info, options) {
    const doc = info || await BusinessInfo.findOne({ userId });
    const response = toBusinessInfoResponse(doc, options);
    if (!response) return response;
    response.hasBooksAmounts = await userHasBooksAmounts(userId);
    return response;
}

const router = express.Router();

async function getOrCreateBusinessInfo(userId) {
    let info = await reconcilePremiumUntilForUser(userId);
    if (!info) {
        info = await BusinessInfo.findOne({ userId });
    }
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
    res.json(await toBusinessInfoClientResponse(req.user.userId, info, { includeAssets: !summary }));
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

    const assetFields = [
        'businessLogo',
        'companyLogoUrl',
        'companyLogoAvatarUrl',
        'companyStampUrl',
        'authorizedSignatureUrl',
    ];
    await Promise.all(
        assetFields
            .filter((field) => updates[field])
            .map(async (field) => {
                updates[field] = await optimizeBusinessAsset(field, updates[field]);
            })
    );

    const existingCurrency = normalizeCurrency(existing.defaultCurrency);
    const nextCurrency =
        updates.defaultCurrency !== undefined
            ? normalizeCurrency(updates.defaultCurrency)
            : existingCurrency;

    let rebase = null;
    let correction = null;
    if (nextCurrency !== existingCurrency) {
        const hasBooksAmounts = await userHasBooksAmounts(req.user.userId);
        if (hasBooksAmounts) {
            const rate = Number(req.body?.currencyExchangeRate);
            if (!isValidExchangeRate(rate)) {
                const err = new Error(`Enter how many ${nextCurrency} equal 1 ${existingCurrency}.`);
                err.status = 400;
                throw err;
            }
            rebase = {
                fromCurrency: existingCurrency,
                toCurrency: nextCurrency,
                rate,
            };
        }
    } else {
        const requestedRate = Number(req.body?.currencyExchangeRate);
        const lastFrom = existing.booksRebaseFrom;
        const lastTo = existing.booksRebaseTo;
        const lastRate = Number(existing.booksRebaseRate);
        const lastAt = existing.booksRebasedAt;
        const stillOnConvertedBooks =
            lastFrom &&
            lastTo &&
            lastAt &&
            isValidExchangeRate(lastRate) &&
            normalizeCurrency(lastTo) === existingCurrency;
        if (stillOnConvertedBooks && isValidExchangeRate(requestedRate)) {
            if (roundExchangeRate(requestedRate) !== roundExchangeRate(lastRate)) {
                correction = {
                    fromCurrency: lastFrom,
                    toCurrency: lastTo,
                    oldRate: lastRate,
                    newRate: requestedRate,
                    rebasedAt: lastAt,
                };
            }
        }
    }

    const info = await persistBusinessCurrencyChange(req.user.userId, updates, rebase, correction);
    invalidateDashboardCache(req.user.userId);
    res.json(await toBusinessInfoClientResponse(req.user.userId, info));
}));

export default router;
