import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPremiumActive, PLANS } from '../utils/businessInfoHelpers.js';

function sanitizePublicBusiness(info) {
    if (!info) {
        return {
            name: 'Business',
            brandColor: '#16A34A',
            plan: PLANS.FREE,
            premiumUntil: null,
        };
    }

    const o = typeof info.toObject === 'function' ? info.toObject() : info;
    const premium = isPremiumActive(o);
    const plan = premium ? PLANS.PREMIUM : PLANS.FREE;
    const logo = premium ? (o.companyLogoUrl || o.businessLogo || '').trim() : '';

    return {
        name: o.name || 'Business',
        brandColor: o.brandColor || '#16A34A',
        plan,
        premiumUntil: premium && o.premiumUntil ? o.premiumUntil : null,
        businessLogo: logo,
        companyLogoUrl: logo,
        companyStampUrl: premium ? (o.companyStampUrl || '').trim() : '',
        authorizedSignatureUrl: premium ? (o.authorizedSignatureUrl || '').trim() : '',
    };
}

test('sanitizePublicBusiness omits premium assets for free users', () => {
    const result = sanitizePublicBusiness({
        name: 'Acme Co',
        plan: PLANS.FREE,
        brandColor: '#2563EB',
        companyLogoUrl: 'data:image/png;base64,logo',
        companyStampUrl: 'data:image/png;base64,stamp',
        authorizedSignatureUrl: 'data:image/png;base64,sig',
    });

    assert.equal(result.plan, PLANS.FREE);
    assert.equal(result.companyLogoUrl, '');
    assert.equal(result.companyStampUrl, '');
    assert.equal(result.authorizedSignatureUrl, '');
});

test('sanitizePublicBusiness includes premium assets for active premium users', () => {
    const result = sanitizePublicBusiness({
        name: 'Acme Co',
        plan: PLANS.PREMIUM,
        premiumUntil: new Date('2099-01-01'),
        brandColor: '#2563EB',
        companyLogoUrl: 'data:image/png;base64,logo',
        companyStampUrl: 'data:image/png;base64,stamp',
        authorizedSignatureUrl: 'data:image/png;base64,sig',
    });

    assert.equal(result.plan, PLANS.PREMIUM);
    assert.equal(result.companyLogoUrl, 'data:image/png;base64,logo');
    assert.equal(result.companyStampUrl, 'data:image/png;base64,stamp');
    assert.equal(result.authorizedSignatureUrl, 'data:image/png;base64,sig');
});
