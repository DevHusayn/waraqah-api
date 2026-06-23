/** CORS for local dev + Vercel frontend */

import { isProduction } from './envValidation.js';

function parseOrigins(value) {
    if (!value || typeof value !== 'string') return [];
    return value.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
}

export function getAllowedOrigins() {
    return [
        process.env.FRONTEND_URL,
        ...parseOrigins(process.env.ALLOWED_ORIGINS),
    ]
        .map((o) => (o ? o.replace(/\/$/, '') : ''))
        .filter(Boolean);
}

export function isOriginAllowed(origin) {
    if (!origin) return true;

    const normalized = origin.replace(/\/$/, '');
    const allowed = getAllowedOrigins();
    const allowVercelPreviews =
        process.env.CORS_ALLOW_VERCEL === 'true' || process.env.VERCEL === '1';

    if (allowed.includes(normalized)) return true;

    if (allowVercelPreviews) {
        try {
            const { hostname } = new URL(origin);
            if (hostname.endsWith('.vercel.app')) return true;
        } catch {
            /* ignore */
        }
    }

    return false;
}

export function buildCorsOptions() {
    const allowed = getAllowedOrigins();
    const production = isProduction();

    return {
        origin(origin, callback) {
            if (!origin) return callback(null, true);

            if (production && allowed.length === 0) {
                return callback(new Error('CORS: FRONTEND_URL or ALLOWED_ORIGINS must be set in production.'));
            }

            if (allowed.length === 0) return callback(null, true);

            if (isOriginAllowed(origin)) return callback(null, true);

            callback(new Error(`CORS: origin not allowed — ${origin}`));
        },
        credentials: true,
    };
}
