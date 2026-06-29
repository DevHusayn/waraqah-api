import crypto from 'crypto';
import { isProduction } from './envValidation.js';
import { JWT_EXPIRY } from './jwtConfig.js';

export const SESSION_COOKIE_NAME = 'waraqah_session';
export const CSRF_COOKIE_NAME = 'waraqah_csrf';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function cookieBaseOptions() {
    const production = isProduction();
    return {
        secure: production,
        sameSite: production ? 'none' : 'lax',
        path: '/',
    };
}

function sessionMaxAgeMs() {
    if (JWT_EXPIRY.endsWith('h')) {
        return Number.parseInt(JWT_EXPIRY, 10) * 60 * 60 * 1000;
    }
    if (JWT_EXPIRY.endsWith('d')) {
        return Number.parseInt(JWT_EXPIRY, 10) * MS_PER_DAY;
    }
    return MS_PER_DAY;
}

export function createCsrfToken() {
    return crypto.randomBytes(32).toString('hex');
}

export function setAuthCookies(res, token) {
    const base = cookieBaseOptions();
    const maxAge = sessionMaxAgeMs();
    const csrfToken = createCsrfToken();

    res.cookie(SESSION_COOKIE_NAME, token, {
        ...base,
        httpOnly: true,
        maxAge,
    });

    res.cookie(CSRF_COOKIE_NAME, csrfToken, {
        ...base,
        httpOnly: false,
        maxAge,
    });
}

export function clearAuthCookies(res) {
    const base = cookieBaseOptions();
    res.clearCookie(SESSION_COOKIE_NAME, { ...base, httpOnly: true });
    res.clearCookie(CSRF_COOKIE_NAME, { ...base, httpOnly: false });
}

export function getTokenFromRequest(req) {
    const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
    if (cookieToken) return cookieToken;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        return authHeader.split(' ')[1];
    }

    return null;
}

export function hasSessionCookie(req) {
    return Boolean(req.cookies?.[SESSION_COOKIE_NAME]);
}
