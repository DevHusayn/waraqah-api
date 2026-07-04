/**
 * Centralized email branding and environment configuration.
 * Override via environment variables in production (Vercel dashboard).
 */

export const BRAND = {
    name: 'Waraqah',
    accent: '#16A34A',
    accentDark: '#15803D',
    accentLight: '#DCFCE7',
    secondary: '#86EFAC',
    text: '#0F172A',
    textMuted: '#64748b',
    textLight: '#94a3b8',
    background: '#F8FAFC',
    surface: '#ffffff',
    border: '#E2E8F0',
    success: '#16A34A',
    info: '#22C55E',
    warning: '#F59E0B',
    error: '#DC2626',
};

export const PASSWORD_RESET_EXPIRY_MINUTES = 15;
export const EMAIL_VERIFICATION_EXPIRY_HOURS = 24;
export const PAYMENT_REMINDER_MIN_DAYS_BETWEEN = 3;
export const PAYMENT_REMINDER_COOLDOWN_MS = PAYMENT_REMINDER_MIN_DAYS_BETWEEN * 24 * 60 * 60 * 1000;

export function getNextPaymentReminderDate(lastPaymentReminderAt) {
    if (!lastPaymentReminderAt) return null;
    const next = new Date(lastPaymentReminderAt);
    next.setDate(next.getDate() + PAYMENT_REMINDER_MIN_DAYS_BETWEEN);
    return next;
}

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

/** Public API base URL — used for hosted email assets (logos). */
export function getApiBaseUrl() {
    const explicit = process.env.API_URL?.trim();
    if (explicit) return explicit.replace(/\/$/, '');
    const port = process.env.PORT || 5000;
    return `http://localhost:${port}/api`;
}
