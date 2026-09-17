import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { MongoRateLimitStore } from './rateLimitStore.js';
import { isProduction } from '../utils/envValidation.js';
import { getTokenFromRequest } from '../utils/authCookie.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const READ_METHODS = new Set(['GET', 'HEAD']);

function clientIp(req) {
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** Decode JWT for rate-limit keying only — invalid tokens fall back to IP. */
function decodeUserId(req) {
    const token = getTokenFromRequest(req);
    if (!token) return null;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        return decoded.userId ? String(decoded.userId) : null;
    } catch {
        return null;
    }
}

function rateLimitKey(req, prefix, { ipOnly = false } = {}) {
    if (!ipOnly) {
        const userId = decodeUserId(req);
        if (userId) return `${prefix}:user:${userId}`;
    }
    return `${prefix}:ip:${clientIp(req)}`;
}

function retryAfterSeconds(resetTime) {
    if (!resetTime) return 60;
    return Math.max(1, Math.ceil(new Date(resetTime).getTime() - Date.now()) / 1000);
}

function rateLimitHandler(req, res, _next, options) {
    const seconds = retryAfterSeconds(req.rateLimit?.resetTime);
    res.setHeader('Retry-After', String(seconds));
    const message = typeof options.message === 'object' ? options.message.message : options.message;
    res.status(options.statusCode).json({
        message,
        retryAfter: seconds,
    });
}

function buildLimiter({ windowMs, max, message, prefix, ipOnly = false, skip }) {
    const options = {
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { message },
        keyGenerator: (req) => rateLimitKey(req, prefix, { ipOnly }),
        skip: (req) => {
            if (req.method === 'OPTIONS') return true;
            if (typeof skip === 'function' && skip(req)) return true;
            return false;
        },
        handler: rateLimitHandler,
    };

    if (isProduction()) {
        options.store = new MongoRateLimitStore();
    }

    return rateLimit(options);
}

/** Routes that use dedicated payment limiters instead of the global read/write limiters. */
export function isPaymentCriticalRoute(req) {
    const path = req.path || '';
    if (path.startsWith('/payments/verify/')) return true;
    if (path === '/payments/plan') return true;
    return false;
}

export const readApiLimiter = buildLimiter({
    windowMs: FIFTEEN_MINUTES,
    max: 600,
    message: 'Too many requests. Please try again later.',
    prefix: 'read',
    skip: (req) => !READ_METHODS.has(req.method) || isPaymentCriticalRoute(req),
});

export const writeApiLimiter = buildLimiter({
    windowMs: FIFTEEN_MINUTES,
    max: 100,
    message: 'Too many requests. Please try again later.',
    prefix: 'write',
    skip: (req) => READ_METHODS.has(req.method) || isPaymentCriticalRoute(req),
});

/** Generous per-user limit for post-checkout verification and subscription status checks. */
export const paymentVerificationLimiter = buildLimiter({
    windowMs: FIFTEEN_MINUTES,
    max: 60,
    message: 'Too many payment verification attempts. Please try again later.',
    prefix: 'pay-verify',
});

export const loginLimiter = buildLimiter({
    windowMs: FIFTEEN_MINUTES,
    max: 10,
    message: 'Too many login attempts. Please try again later.',
    prefix: 'login',
    ipOnly: true,
});

/** Extra cap for Premium AI document drafts (on top of the global write limiter). */
export const aiDraftLimiter = buildLimiter({
    windowMs: ONE_HOUR,
    max: 20,
    message: 'Too many AI draft requests. Please try again later.',
    prefix: 'ai-draft',
});

export const registerLimiter = buildLimiter({
    windowMs: ONE_HOUR,
    max: 5,
    message: 'Too many registration attempts. Please try again later.',
    prefix: 'register',
    ipOnly: true,
});

export const forgotPasswordLimiter = buildLimiter({
    windowMs: ONE_HOUR,
    max: 3,
    message: 'Too many password reset requests. Please try again later.',
    prefix: 'forgot',
    ipOnly: true,
});

export const adminEmailLimiter = buildLimiter({
    windowMs: ONE_HOUR,
    max: 20,
    message: 'Too many admin emails. Please try again later.',
    prefix: 'admin-email',
});

export const resetPasswordLimiter = buildLimiter({
    windowMs: ONE_HOUR,
    max: 10,
    message: 'Too many password reset attempts. Please try again later.',
    prefix: 'reset',
    ipOnly: true,
});

export const changePasswordLimiter = buildLimiter({
    windowMs: FIFTEEN_MINUTES,
    max: 10,
    message: 'Too many password change attempts. Please try again later.',
    prefix: 'change-password',
});

/** @deprecated Webhook is not rate-limited; Paystack signature verification is the security boundary. */
export const webhookLimiter = buildLimiter({
    windowMs: 60 * 1000,
    max: 100,
    message: 'Too many webhook requests.',
    prefix: 'webhook',
});
