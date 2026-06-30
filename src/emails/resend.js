import { Resend } from 'resend';
import { getEmailFromAddress, isResendConfigured } from './config.js';
import { EmailNotConfiguredError } from './errors.js';

let cachedClient = null;

/**
 * Lazy singleton Resend client — safe for serverless cold starts.
 */
export function getResendClient() {
    if (!isResendConfigured()) {
        return null;
    }

    if (!cachedClient) {
        cachedClient = new Resend(process.env.RESEND_API_KEY.trim());
    }

    return cachedClient;
}

export function assertResendConfigured() {
    if (!isResendConfigured()) {
        throw new EmailNotConfiguredError();
    }
}

export function getDefaultFrom() {
    return getEmailFromAddress();
}
