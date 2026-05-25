/** Shape and sanitize business profile for API responses */

export const PLANS = {
    FREE: 'free',
    PREMIUM: 'premium',
};

const ALLOWED_UPDATE_FIELDS = [
    'name',
    'address',
    'email',
    'phone',
    'website',
    'taxRate',
    'brandColor',
    'businessLogo',
    'companyLogoUrl',
    'companyLogoAvatarUrl',
    'companyStampUrl',
    'authorizedSignatureUrl',
];

const PREMIUM_PNG_ASSET_FIELDS = [
    'companyLogoUrl',
    'companyStampUrl',
    'authorizedSignatureUrl',
];

const PREMIUM_JPEG_ASSET_FIELDS = ['companyLogoAvatarUrl'];

export function isValidPngDataUrl(value) {
    if (value === undefined || value === null || value === '') return true;
    return typeof value === 'string' && value.startsWith('data:image/png');
}

export function isValidJpegDataUrl(value) {
    if (value === undefined || value === null || value === '') return true;
    return typeof value === 'string' && value.startsWith('data:image/jpeg');
}

function resolveCompanyLogo(doc) {
    const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    return (o.companyLogoUrl || o.businessLogo || '').trim();
}

export function pickAllowedBusinessUpdates(body, { allowPlan = false } = {}) {
    const updates = {};
    for (const key of ALLOWED_UPDATE_FIELDS) {
        if (body[key] !== undefined) {
            updates[key] = body[key];
        }
    }

    if (body.businessLogo !== undefined && body.companyLogoUrl === undefined) {
        updates.companyLogoUrl = body.businessLogo;
    }
    if (updates.businessLogo !== undefined) {
        updates.companyLogoUrl = updates.companyLogoUrl ?? updates.businessLogo;
    }

    for (const field of PREMIUM_PNG_ASSET_FIELDS) {
        if (updates[field] !== undefined && !isValidPngDataUrl(updates[field])) {
            const err = new Error(`${field} must be a PNG image (data:image/png).`);
            err.status = 400;
            throw err;
        }
    }

    for (const field of PREMIUM_JPEG_ASSET_FIELDS) {
        if (updates[field] !== undefined && !isValidJpegDataUrl(updates[field])) {
            const err = new Error(`${field} must be a JPEG image (data:image/jpeg).`);
            err.status = 400;
            throw err;
        }
    }

    if (allowPlan && body.plan !== undefined) {
        updates.plan = body.plan === PLANS.PREMIUM ? PLANS.PREMIUM : PLANS.FREE;
        if (updates.plan === PLANS.FREE) {
            clearPremiumAssets(updates);
        }
    }
    updates.defaultCurrency = 'NGN';
    return updates;
}

function clearPremiumAssets(target) {
    target.businessLogo = '';
    target.companyLogoUrl = '';
    target.companyLogoAvatarUrl = '';
    target.companyStampUrl = '';
    target.authorizedSignatureUrl = '';
}

export function isPremiumActive(doc) {
    if (!doc) return false;
    const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    if (o.plan !== PLANS.PREMIUM) return false;
    if (!o.premiumUntil) return true;
    return new Date(o.premiumUntil) > new Date();
}

export function toBusinessInfoResponse(doc) {
    if (!doc) return null;
    const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    const premium = isPremiumActive(o);
    const plan = premium ? PLANS.PREMIUM : PLANS.FREE;
    const logo = premium ? resolveCompanyLogo(o) : '';

    return {
        name: o.name || '',
        address: o.address || '',
        email: o.email || '',
        phone: o.phone || '',
        website: o.website || '',
        defaultCurrency: 'NGN',
        taxRate: typeof o.taxRate === 'number' ? o.taxRate : 10,
        brandColor: o.brandColor || '#0ea5e9',
        plan,
        premiumUntil: premium && o.premiumUntil ? o.premiumUntil : null,
        subscriptionStatus: o.subscriptionStatus || null,
        subscriptionRenews: o.subscriptionStatus === 'active' && o.premiumUntil ? o.premiumUntil : null,
        paystackSubscriptionCode: o.paystackSubscriptionCode || '',
        businessLogo: logo,
        companyLogoUrl: logo,
        companyLogoAvatarUrl: premium ? (o.companyLogoAvatarUrl || '').trim() : '',
        companyStampUrl: premium ? (o.companyStampUrl || '').trim() : '',
        authorizedSignatureUrl: premium ? (o.authorizedSignatureUrl || '').trim() : '',
    };
}

export function applyPremiumLogoRules(updates, existingDoc) {
    const premium = typeof existingDoc === 'object' && existingDoc !== null
        ? isPremiumActive(existingDoc)
        : existingDoc === PLANS.PREMIUM;
    if (!premium) {
        clearPremiumAssets(updates);
    }
    return updates;
}

export const defaultBusinessInfoFields = {
    name: '',
    address: '',
    email: '',
    phone: '',
    website: '',
    defaultCurrency: 'NGN',
    taxRate: 10,
    brandColor: '#0ea5e9',
    plan: PLANS.FREE,
    businessLogo: '',
    companyLogoUrl: '',
    companyLogoAvatarUrl: '',
    companyStampUrl: '',
    authorizedSignatureUrl: '',
};
