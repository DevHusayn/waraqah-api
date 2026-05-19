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
];

export function pickAllowedBusinessUpdates(body, { allowPlan = false } = {}) {
    const updates = {};
    for (const key of ALLOWED_UPDATE_FIELDS) {
        if (body[key] !== undefined) {
            updates[key] = body[key];
        }
    }
    if (allowPlan && body.plan !== undefined) {
        updates.plan = body.plan === PLANS.PREMIUM ? PLANS.PREMIUM : PLANS.FREE;
        if (updates.plan === PLANS.FREE) {
            updates.businessLogo = '';
        }
    }
    updates.defaultCurrency = 'NGN';
    return updates;
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
        businessLogo: premium ? (o.businessLogo || '') : '',
    };
}

export function applyPremiumLogoRules(updates, existingDoc) {
    const premium = typeof existingDoc === 'object' && existingDoc !== null
        ? isPremiumActive(existingDoc)
        : existingDoc === PLANS.PREMIUM;
    if (!premium) {
        updates.businessLogo = '';
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
};
