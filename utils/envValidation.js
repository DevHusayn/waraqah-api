const MIN_JWT_SECRET_LENGTH = 32;

export function isProduction() {
    return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
}

export function validateEnv() {
    const errors = [];
    const warnings = [];

    if (isProduction()) {
        if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
            errors.push(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters in production.`);
        }
        if (!process.env.MONGO_URI) {
            errors.push('MONGO_URI is required in production.');
        }
        if (!process.env.FRONTEND_URL) {
            errors.push('FRONTEND_URL is required in production for CORS and payment redirects.');
        }
        if (process.env.ALLOW_DEV_PLAN === 'true') {
            errors.push('ALLOW_DEV_PLAN must be false in production.');
        }
        if (!process.env.RESEND_API_KEY?.trim()) {
            errors.push('RESEND_API_KEY is required in production for transactional email.');
        }
    } else if (process.env.ALLOW_DEV_PLAN === 'true') {
        warnings.push('ALLOW_DEV_PLAN is enabled — do not use in production.');
    }

    if (isProduction() && process.env.VERCEL_REGION && process.env.MONGO_URI?.includes('mongodb')) {
        warnings.push(
            `For lowest latency, deploy MongoDB Atlas in the same region as Vercel (${process.env.VERCEL_REGION}).`
        );
    }

    return { errors, warnings };
}

export function assertEnvOrExit() {
    const { errors, warnings } = validateEnv();
    for (const warning of warnings) {
        console.warn(`[env] ${warning}`);
    }
    if (errors.length > 0) {
        for (const error of errors) {
            console.error(`[env] ${error}`);
        }
        if (isProduction()) {
            throw new Error('Invalid production environment configuration.');
        }
    }
}
