import { sanitizePlainText, sanitizeOptionalEmail, sanitizeHexColor, sanitizeNumber, sanitizeDataUrl } from './sanitize.js';
import { normalizeTimezone } from './timezone.js';
import { APP_CURRENCY, DEFAULT_COUNTRY, assertValidCountry, assertValidCurrency, normalizeCountry, normalizeCurrency } from './locale.js';

export const PLANS = {
    FREE: 'free',
    PREMIUM: 'premium',
};

export const DEFAULT_TEMPLATE_ID = 'classic';

export const INVOICE_TEMPLATE_IDS = [
    'classic',
    'modern',
    'minimal',
    'bold',
    'compact',
    'professional',
    'sidebar',
    'corporate',
    'creative',
    'executive',
];

export const FREE_TEMPLATE_IDS = INVOICE_TEMPLATE_IDS.slice(0, 5);
export const PREMIUM_TEMPLATE_IDS = INVOICE_TEMPLATE_IDS.slice(5);

export function isTemplateAllowedForPlan(templateId, premium) {
    if (!INVOICE_TEMPLATE_IDS.includes(templateId)) return false;
    if (FREE_TEMPLATE_IDS.includes(templateId)) return true;
    return Boolean(premium);
}

const ALLOWED_UPDATE_FIELDS = [
    'name',
    'address',
    'email',
    'phone',
    'website',
    'timezone',
    'country',
    'defaultCurrency',
    'taxRate',
    'brandColor',
    'defaultDocumentFooter',
    'businessLogo',
    'companyLogoUrl',
    'companyLogoAvatarUrl',
    'companyStampUrl',
    'authorizedSignatureUrl',
    'paymentAccountName',
    'paymentBankName',
    'paymentAccountNumber',
    'paymentSortCode',
    'paymentIban',
    'paymentSwift',
    'paymentInstructions',
    'invoiceTemplateId',
    'autoEmailInvoices',
    'autoPaymentReminders',
    'lowStockEmailAlerts',
    'allowOverselling',
    'autoUpdateCostFromPO',
    'autoEmailMonthlyStatements',
];

const PREMIUM_PNG_ASSET_FIELDS = [
    'companyLogoUrl',
    'companyStampUrl',
    'authorizedSignatureUrl',
];

const PREMIUM_JPEG_ASSET_FIELDS = ['companyLogoAvatarUrl'];

const TEXT_LIMITS = {
    name: 200,
    address: 500,
    email: 254,
    phone: 50,
    website: 200,
    paymentAccountName: 120,
    paymentBankName: 120,
    paymentAccountNumber: 40,
    paymentSortCode: 20,
    paymentIban: 42,
    paymentSwift: 20,
    paymentInstructions: 1000,
    defaultDocumentFooter: 500,
};

const MAX_ASSET_BYTES = 500 * 1024;

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

export function pickAllowedBusinessUpdates(body, { allowPlan = false, premium = false } = {}) {
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
        if (updates[field] !== undefined) {
            updates[field] = sanitizeDataUrl(updates[field], {
                maxBytes: MAX_ASSET_BYTES,
                allowedPrefixes: ['data:image/png'],
            });
        }
        if (updates[field] !== undefined && !isValidPngDataUrl(updates[field])) {
            const err = new Error(`${field} must be a PNG image (data:image/png).`);
            err.status = 400;
            throw err;
        }
    }

    for (const field of PREMIUM_JPEG_ASSET_FIELDS) {
        if (updates[field] !== undefined) {
            updates[field] = sanitizeDataUrl(updates[field], {
                maxBytes: MAX_ASSET_BYTES,
                allowedPrefixes: ['data:image/jpeg'],
            });
        }
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

    if (updates.invoiceTemplateId !== undefined) {
        const templateId = String(updates.invoiceTemplateId || DEFAULT_TEMPLATE_ID);
        if (!isTemplateAllowedForPlan(templateId, premium)) {
            const err = new Error('This invoice template requires a Premium plan.');
            err.status = 403;
            throw err;
        }
        updates.invoiceTemplateId = templateId;
    }

    for (const key of ['name', 'address', 'phone', 'website']) {
        if (updates[key] !== undefined) {
            updates[key] = sanitizePlainText(updates[key], TEXT_LIMITS[key]);
        }
    }

    if (updates.email !== undefined) {
        updates.email = sanitizeOptionalEmail(updates.email);
    }

    if (updates.brandColor !== undefined) {
        updates.brandColor = sanitizeHexColor(updates.brandColor);
    }

    if (updates.defaultDocumentFooter !== undefined) {
        if (!premium) {
            delete updates.defaultDocumentFooter;
        } else {
            updates.defaultDocumentFooter = sanitizePlainText(
                updates.defaultDocumentFooter,
                TEXT_LIMITS.defaultDocumentFooter
            );
        }
    }

    if (updates.taxRate !== undefined) {
        updates.taxRate = sanitizeNumber(updates.taxRate, { min: 0, max: 100, fallback: 10 });
    }

    if (updates.autoEmailInvoices !== undefined) {
        updates.autoEmailInvoices = Boolean(updates.autoEmailInvoices);
    }

    if (updates.autoPaymentReminders !== undefined) {
        updates.autoPaymentReminders = Boolean(updates.autoPaymentReminders);
    }

    if (updates.lowStockEmailAlerts !== undefined) {
        updates.lowStockEmailAlerts = Boolean(updates.lowStockEmailAlerts);
    }

    if (updates.allowOverselling !== undefined) {
        updates.allowOverselling = Boolean(updates.allowOverselling);
    }

    if (updates.autoUpdateCostFromPO !== undefined) {
        updates.autoUpdateCostFromPO = Boolean(updates.autoUpdateCostFromPO);
    }

    if (updates.autoEmailMonthlyStatements !== undefined) {
        updates.autoEmailMonthlyStatements = Boolean(updates.autoEmailMonthlyStatements);
    }

    if (updates.timezone !== undefined) {
        updates.timezone = normalizeTimezone(updates.timezone);
    }

    if (updates.country !== undefined) {
        updates.country = assertValidCountry(updates.country);
    }

    if (updates.defaultCurrency !== undefined) {
        updates.defaultCurrency = assertValidCurrency(updates.defaultCurrency);
    }

    for (const key of [
        'paymentAccountName',
        'paymentBankName',
        'paymentAccountNumber',
        'paymentSortCode',
        'paymentIban',
        'paymentSwift',
        'paymentInstructions',
    ]) {
        if (updates[key] !== undefined) {
            updates[key] = sanitizePlainText(updates[key], TEXT_LIMITS[key]);
        }
    }

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

const EMPTY_ASSET_FIELDS = {
    businessLogo: '',
    companyLogoUrl: '',
    companyLogoAvatarUrl: '',
    companyStampUrl: '',
    authorizedSignatureUrl: '',
};

export function toBusinessInfoResponse(doc, { includeAssets = true } = {}) {
    if (!doc) return null;
    const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    const premium = isPremiumActive(o);
    const plan = premium ? PLANS.PREMIUM : PLANS.FREE;
    const logo = premium && includeAssets ? resolveCompanyLogo(o) : '';

    let invoiceTemplateId = o.invoiceTemplateId || DEFAULT_TEMPLATE_ID;
    if (!isTemplateAllowedForPlan(invoiceTemplateId, premium)) {
        invoiceTemplateId = DEFAULT_TEMPLATE_ID;
    }

    const assets = includeAssets
        ? {
            businessLogo: logo,
            companyLogoUrl: logo,
            companyLogoAvatarUrl: premium ? (o.companyLogoAvatarUrl || '').trim() : '',
            companyStampUrl: premium ? (o.companyStampUrl || '').trim() : '',
            authorizedSignatureUrl: premium ? (o.authorizedSignatureUrl || '').trim() : '',
        }
        : EMPTY_ASSET_FIELDS;

    return {
        name: o.name || '',
        address: o.address || '',
        email: o.email || '',
        phone: o.phone || '',
        website: o.website || '',
        timezone: normalizeTimezone(o.timezone),
        country: normalizeCountry(o.country),
        defaultCurrency: normalizeCurrency(o.defaultCurrency),
        taxRate: typeof o.taxRate === 'number' ? o.taxRate : 10,
        brandColor: o.brandColor || '#16A34A',
        defaultDocumentFooter: premium ? (o.defaultDocumentFooter || '') : '',
        plan,
        premiumUntil: premium && o.premiumUntil ? o.premiumUntil : null,
        subscriptionStatus: o.subscriptionStatus || null,
        subscriptionRenews: o.subscriptionStatus === 'active' && o.premiumUntil ? o.premiumUntil : null,
        billingInterval: o.billingInterval || null,
        paystackSubscriptionCode: o.paystackSubscriptionCode || '',
        ...assets,
        paymentAccountName: o.paymentAccountName || '',
        paymentBankName: o.paymentBankName || '',
        paymentAccountNumber: o.paymentAccountNumber || '',
        paymentSortCode: o.paymentSortCode || '',
        paymentIban: o.paymentIban || '',
        paymentSwift: o.paymentSwift || '',
        paymentInstructions: o.paymentInstructions || '',
        invoiceTemplateId,
        autoEmailInvoices: Boolean(o.autoEmailInvoices),
        autoPaymentReminders: o.autoPaymentReminders !== false,
        lowStockEmailAlerts: Boolean(o.lowStockEmailAlerts),
        allowOverselling: Boolean(o.allowOverselling),
        autoUpdateCostFromPO: Boolean(o.autoUpdateCostFromPO),
        autoEmailMonthlyStatements: o.autoEmailMonthlyStatements !== false,
        booksRebasedAt: o.booksRebasedAt || null,
        booksRebaseFrom: o.booksRebaseFrom || null,
        booksRebaseTo: o.booksRebaseTo || null,
        booksRebaseRate: typeof o.booksRebaseRate === 'number' ? o.booksRebaseRate : null,
    };
}

export function toBusinessAssetResponse(doc) {
    const full = toBusinessInfoResponse(doc, { includeAssets: true });
    if (!full) return EMPTY_ASSET_FIELDS;
    return {
        businessLogo: full.businessLogo,
        companyLogoUrl: full.companyLogoUrl,
        companyLogoAvatarUrl: full.companyLogoAvatarUrl,
        companyStampUrl: full.companyStampUrl,
        authorizedSignatureUrl: full.authorizedSignatureUrl,
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

export function isBusinessSetupComplete(info = {}) {
    const name = String(info.name || '').trim();
    const address = String(info.address || '').trim();
    const email = String(info.email || '').trim();
    const phone = String(info.phone || '').trim();
    if (!name || !address || !email || !phone) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export const defaultBusinessInfoFields = {
    name: '',
    address: '',
    email: '',
    phone: '',
    website: '',
    timezone: 'Africa/Lagos',
    country: DEFAULT_COUNTRY,
    defaultCurrency: APP_CURRENCY,
    taxRate: 10,
    brandColor: '#16A34A',
    defaultDocumentFooter: '',
    plan: PLANS.FREE,
    businessLogo: '',
    companyLogoUrl: '',
    companyLogoAvatarUrl: '',
    companyStampUrl: '',
    authorizedSignatureUrl: '',
    paymentAccountName: '',
    paymentBankName: '',
    paymentAccountNumber: '',
    paymentSortCode: '',
    paymentIban: '',
    paymentSwift: '',
    paymentInstructions: '',
    invoiceTemplateId: DEFAULT_TEMPLATE_ID,
    autoEmailInvoices: false,
    autoPaymentReminders: true,
    lowStockEmailAlerts: false,
    allowOverselling: false,
    autoUpdateCostFromPO: false,
    autoEmailMonthlyStatements: true,
};
