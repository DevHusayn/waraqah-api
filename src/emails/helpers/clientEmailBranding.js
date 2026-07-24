import { BRAND, getApiBaseUrl, getEmailFromAddress } from '../config.js';
import { sanitizeHexColor } from '../../../utils/sanitize.js';
import { isPremiumActive } from '../../../utils/businessInfoHelpers.js';

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
 * Data URLs break HTML email (line-length limits, client blocking). Host via public API instead.
 */
function isPubliclyReachableUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
        const host = parsed.hostname.toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
        if (host.endsWith('.local')) return false;
        return true;
    } catch {
        return false;
    }
}

export function resolveEmailLogoUrl(rawLogo, publicToken, documentPath = 'invoices') {
    const trimmed = String(rawLogo || '').trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
        // Skip private/local URLs — email clients and Resend cannot fetch them.
        return isPubliclyReachableUrl(trimmed) ? trimmed : null;
    }
    if (trimmed.startsWith('data:') && publicToken) {
        const path = documentPath === 'quotations' ? 'quotations' : 'invoices';
        const hosted = `${getApiBaseUrl()}/public/${path}/${encodeURIComponent(publicToken)}/logo`;
        return isPubliclyReachableUrl(hosted) ? hosted : null;
    }
    return null;
}

/**
 * Build branding tokens for client-facing invoice emails.
 */
export function buildClientEmailBranding(businessInfo, businessName, options = {}) {
    const { publicToken, documentPath = 'invoices' } = options;
    const name = businessName?.trim() || businessInfo?.name?.trim() || 'Your business';
    const brandColor = sanitizeHexColor(businessInfo?.brandColor, BRAND.accent);
    const premium = isPremiumActive(businessInfo);
    const rawLogo = premium ? resolveBusinessLogo(businessInfo) : '';
    const logoUrl = resolveEmailLogoUrl(rawLogo, publicToken, documentPath);

    return {
        businessName: name,
        brandColor,
        accentDark: adjustColor(brandColor, { darken: 0.15 }),
        accentLight: adjustColor(brandColor, { lighten: 0.88 }),
        logoUrl,
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

export function parseDataUrlImage(dataUrl) {
    const trimmed = String(dataUrl || '').trim();
    const match = trimmed.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    try {
        return {
            mime: match[1],
            buffer: Buffer.from(match[2], 'base64'),
        };
    } catch {
        return null;
    }
}
