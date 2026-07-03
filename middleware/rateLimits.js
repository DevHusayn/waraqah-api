import rateLimit from 'express-rate-limit';
import { MongoRateLimitStore } from './rateLimitStore.js';
import { isProduction } from '../utils/envValidation.js';

function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

function buildLimiter({ windowMs, max, message, prefix }) {
    const options = {
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { message },
        keyGenerator: (req) => `${prefix}:${clientIp(req)}`,
        skip: (req) => req.method === 'OPTIONS',
    };

    // Avoid an extra Mongo round-trip on every request during local dev.
    if (isProduction()) {
        options.store = new MongoRateLimitStore();
    }

    return rateLimit(options);
}

export const globalApiLimiter = buildLimiter({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: 'Too many requests. Please try again later.',
    prefix: 'global',
});

export const loginLimiter = buildLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many login attempts. Please try again later.',
    prefix: 'login',
});

export const registerLimiter = buildLimiter({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: 'Too many registration attempts. Please try again later.',
    prefix: 'register',
});

export const forgotPasswordLimiter = buildLimiter({
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: 'Too many password reset requests. Please try again later.',
    prefix: 'forgot',
});

export const resetPasswordLimiter = buildLimiter({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: 'Too many password reset attempts. Please try again later.',
    prefix: 'reset',
});

export const webhookLimiter = buildLimiter({
    windowMs: 60 * 1000,
    max: 100,
    message: 'Too many webhook requests.',
    prefix: 'webhook',
});
