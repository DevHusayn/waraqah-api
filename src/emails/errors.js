import { BRAND } from './config.js';

/**
 * Maps Resend / transport errors to safe, user-facing messages.
 * Never expose raw provider errors to API clients.
 */
export function getEmailErrorMessage(err) {
    const code = err?.code || '';
    const name = err?.name || '';
    const message = String(err?.message || '').toLowerCase();
    const statusCode = err?.statusCode || err?.status;

    if (code === 'EMAIL_NOT_CONFIGURED' || name === 'EmailNotConfiguredError') {
        return 'Email is not available right now. Please contact support.';
    }

    if (code === 'INVALID_RECIPIENT' || name === 'InvalidRecipientError') {
        return 'Please provide a valid email address.';
    }

    if (statusCode === 429 || message.includes('rate limit') || message.includes('too many')) {
        return 'Please wait a few minutes before requesting another email.';
    }

    if (message.includes('invalid api key') || message.includes('unauthorized')) {
        if (process.env.NODE_ENV !== 'production') {
            return 'Resend rejected the API key. Check RESEND_API_KEY in your environment.';
        }
        return 'We could not send the email right now. Please try again later or contact support.';
    }

    if (message.includes('domain') && message.includes('verify')) {
        if (process.env.NODE_ENV !== 'production') {
            return 'Resend domain is not verified. Verify mywaraqah.com in the Resend dashboard.';
        }
        return 'We could not send the email right now. Please contact support.';
    }

    return 'We could not send the email. Please try again in a few minutes.';
}

export class EmailNotConfiguredError extends Error {
    constructor() {
        super('EMAIL_NOT_CONFIGURED');
        this.name = 'EmailNotConfiguredError';
        this.code = 'EMAIL_NOT_CONFIGURED';
    }
}

export class InvalidRecipientError extends Error {
    constructor(email) {
        super(`Invalid recipient: ${email}`);
        this.name = 'InvalidRecipientError';
        this.code = 'INVALID_RECIPIENT';
    }
}

export function logEmailSuccess({ type, to, id }) {
    console.info(`[${BRAND.name} Email] Sent ${type}`, { to, id });
}

export function logEmailFailure({ type, to, err }) {
    console.error(`[${BRAND.name} Email] Failed ${type}`, {
        to,
        message: err?.message,
        statusCode: err?.statusCode || err?.status,
        name: err?.name,
    });
}

export function normalizeResendError(err) {
    if (err?.error) {
        const providerError = new Error(err.error.message || 'Resend API error');
        providerError.statusCode = err.error.statusCode;
        providerError.name = err.error.name || 'ResendError';
        return providerError;
    }
    return err;
}
