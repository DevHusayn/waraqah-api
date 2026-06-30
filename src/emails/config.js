/**
 * Centralized email branding and environment configuration.
 * Override via environment variables in production (Vercel dashboard).
 */

export const BRAND = {
    name: 'Waraqah',
    accent: '#0ea5e9',
    accentDark: '#0284c7',
    accentLight: '#e0f2fe',
    text: '#0f172a',
    textMuted: '#64748b',
    textLight: '#94a3b8',
    background: '#f1f5f9',
    surface: '#ffffff',
    border: '#e2e8f0',
};

export const PASSWORD_RESET_EXPIRY_MINUTES = 15;

export function getEmailFromAddress() {
    return process.env.EMAIL_FROM?.trim() || 'Waraqah <notifications@mywaraqah.com>';
}

export function getSupportEmail() {
    return process.env.EMAIL_SUPPORT?.trim() || 'support@mywaraqah.com';
}

export function getWebsiteUrl() {
    const url = process.env.EMAIL_WEBSITE_URL?.trim()
        || process.env.FRONTEND_URL?.trim()
        || 'https://mywaraqah.com';
    return url.replace(/\/$/, '');
}

export function getLogoUrl() {
    const explicit = process.env.EMAIL_LOGO_URL?.trim();
    if (explicit) return explicit;
    return `${getWebsiteUrl()}/logo.png`;
}

export function getCopyrightYear() {
    return new Date().getFullYear();
}

export function isResendConfigured() {
    return Boolean(process.env.RESEND_API_KEY?.trim());
}

export function isProductionEnvironment() {
    return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
}
