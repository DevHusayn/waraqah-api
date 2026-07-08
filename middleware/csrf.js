import { CSRF_COOKIE_NAME, hasSessionCookie } from '../utils/authCookie.js';

const CSRF_EXEMPT_PREFIXES = [
    '/auth/login',
    '/auth/register',
    '/auth/logout',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/auth/verify-email',
    '/auth/resend-verification-email',
    '/auth/google',
    '/payments/webhook',
];

function isCsrfExempt(path) {
    return CSRF_EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Double-submit CSRF check for cookie-based sessions (skipped for Bearer-only mobile clients). */
export default function csrfProtection(req, res, next) {
    const method = req.method.toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        return next();
    }

    if (isCsrfExempt(req.path)) {
        return next();
    }

    if (!hasSessionCookie(req)) {
        return next();
    }

    const csrfCookie = req.cookies?.[CSRF_COOKIE_NAME];
    const csrfHeader = req.headers['x-csrf-token'];

    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        return res.status(403).json({ message: 'Invalid or missing CSRF token.' });
    }

    return next();
}
