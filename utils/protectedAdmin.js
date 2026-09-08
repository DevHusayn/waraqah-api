const DEFAULT_PROTECTED_ADMIN_EMAILS = ['husaynmubarak0@gmail.com'];

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

export function getProtectedAdminEmails() {
    const fromEnv = String(process.env.PROTECTED_ADMIN_EMAILS || '')
        .split(',')
        .map(normalizeEmail)
        .filter(Boolean);
    return new Set([...DEFAULT_PROTECTED_ADMIN_EMAILS, ...fromEnv]);
}

export function isProtectedAdminEmail(email) {
    const normalized = normalizeEmail(email);
    return Boolean(normalized) && getProtectedAdminEmails().has(normalized);
}

export function isProtectedAdminUser(user) {
    return isProtectedAdminEmail(user?.email);
}
