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
    return process.env.EMAIL_FROM?.trim() || 'Waraqah <no_reply@mail.mywaraqah.com>';
}

function extractEmailAddress(value) {
    const trimmed = String(value || '').trim();
    const match = trimmed.match(/<([^>]+)>/);
    return (match ? match[1] : trimmed).trim();
}

/** Verified From mailbox for client-facing documents (invoices, reminders, receipts). */
export function getClientFromEmail() {
    const explicit = process.env.EMAIL_CLIENT_FROM?.trim();
    if (explicit) {
        return toVerifiedFromEmail(extractEmailAddress(explicit));
    }
    return 'invoices@mail.mywaraqah.com';
}

/** Owner alerts and platform notifications (invoice paid, low stock, etc.). */
export function getNotificationFromAddress() {
    return process.env.EMAIL_NOTIFICATIONS_FROM?.trim() || 'Waraqah <notifications@mail.mywaraqah.com>';
}

/** Founder welcome email — personal onboarding note for new signups. */
export function getWelcomeEmailFromAddress() {
    return process.env.EMAIL_WELCOME_FROM?.trim() || 'Waraqah <founder@mail.mywaraqah.com>';
}

export function getSupportEmail() {
    return process.env.EMAIL_SUPPORT?.trim() || 'support@mywaraqah.com';
}

/**
 * Resend only delivers from the verified mail. subdomain.
 * Apex addresses like support@mywaraqah.com are rewritten to @mail.mywaraqah.com.
 */
export function toVerifiedFromEmail(email) {
    const value = String(email || '').trim();
    const at = value.lastIndexOf('@');
    if (at === -1) return value;
    const local = value.slice(0, at);
    const domain = value.slice(at + 1).toLowerCase();
    if (domain === 'mywaraqah.com') {
        return `${local}@mail.mywaraqah.com`;
    }
    return value;
}

/** Verified From mailbox for admin Support / custom-reply messages. */
export function getSupportFromEmail() {
    return toVerifiedFromEmail(process.env.EMAIL_SUPPORT_FROM?.trim() || 'support@mail.mywaraqah.com');
}

/** Verified From mailbox for admin no-reply messages. */
export function getNoReplyEmail() {
    return toVerifiedFromEmail(process.env.EMAIL_NOREPLY?.trim() || 'noreply@mail.mywaraqah.com');
}

/** Inbox for platform ops alerts (e.g. new signups). Falls back to support email. */
export function getAdminNotifyEmail() {
    return process.env.ADMIN_EMAIL?.trim() || getSupportEmail();
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

/** Circular W mark for email lockups (icon + wordmark). */
export function getLogoIconUrl() {
    const explicit = process.env.EMAIL_LOGO_ICON_URL?.trim();
    if (explicit) return explicit;
    return `${getWebsiteUrl()}/logo-icon.png`;
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
