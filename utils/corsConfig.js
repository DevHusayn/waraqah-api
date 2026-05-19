/** CORS for local dev + Vercel frontend */

function parseOrigins(value) {
    if (!value || typeof value !== 'string') return [];
    return value.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
}

export function buildCorsOptions() {
    const allowed = [
        process.env.FRONTEND_URL,
        ...parseOrigins(process.env.ALLOWED_ORIGINS),
    ]
        .map((o) => (o ? o.replace(/\/$/, '') : ''))
        .filter(Boolean);

    const allowVercelPreviews =
        process.env.CORS_ALLOW_VERCEL === 'true' || process.env.VERCEL === '1';

    return {
        origin(origin, callback) {
            if (!origin) return callback(null, true);

            const normalized = origin.replace(/\/$/, '');

            if (allowed.length === 0) return callback(null, true);

            if (allowed.includes(normalized)) return callback(null, true);

            if (allowVercelPreviews) {
                try {
                    const { hostname } = new URL(origin);
                    if (hostname.endsWith('.vercel.app')) return callback(null, true);
                } catch {
                    /* ignore */
                }
            }

            callback(new Error(`CORS: origin not allowed — ${origin}`));
        },
        credentials: true,
    };
}
