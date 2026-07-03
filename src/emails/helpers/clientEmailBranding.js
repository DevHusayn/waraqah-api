import { BRAND, getEmailFromAddress } from '../config.js';
import { sanitizeHexColor } from '../../../utils/sanitize.js';

function hexToRgb(hex) {
    const normalized = hex.replace('#', '');
    if (normalized.length !== 6) return null;
    return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16),
    };
}

function rgbToHex(r, g, b) {
    return `#${[r, g, b]
        .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
        .join('')}`;
}

function adjustColor(hex, { lighten = 0, darken = 0 }) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;

    if (darken > 0) {
        return rgbToHex(
            rgb.r * (1 - darken),
            rgb.g * (1 - darken),
            rgb.b * (1 - darken),
        );
    }

    return rgbToHex(
        rgb.r + (255 - rgb.r) * lighten,
        rgb.g + (255 - rgb.g) * lighten,
        rgb.b + (255 - rgb.b) * lighten,
    );
}

function resolveBusinessLogo(businessInfo) {
    if (!businessInfo) return '';
    const doc = typeof businessInfo.toObject === 'function'
        ? businessInfo.toObject()
        : businessInfo;
    return (doc.companyLogoUrl || doc.businessLogo || doc.companyLogoAvatarUrl || '').trim();
}

/**
 * Build branding tokens for client-facing invoice emails.
 */
export function buildClientEmailBranding(businessInfo, businessName) {
    const name = businessName?.trim() || businessInfo?.name?.trim() || 'Your business';
    const brandColor = sanitizeHexColor(businessInfo?.brandColor, BRAND.accent);
    const logoUrl = resolveBusinessLogo(businessInfo);

    return {
        businessName: name,
        brandColor,
        accentDark: adjustColor(brandColor, { darken: 0.15 }),
        accentLight: adjustColor(brandColor, { lighten: 0.88 }),
        logoUrl: logoUrl || null,
    };
}

/**
 * Use the business name as the visible sender while keeping the verified domain address.
 */
export function getClientEmailFromAddress(businessName) {
    const defaultFrom = getEmailFromAddress();
    const match = defaultFrom.match(/<([^>]+)>/);
    const emailAddress = match ? match[1] : defaultFrom.trim();
    const displayName = businessName?.trim() || BRAND.name;
    const safeName = displayName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${safeName}" <${emailAddress}>`;
}
