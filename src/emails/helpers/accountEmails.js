import {
    sendWelcomeEmail,
    sendEmailVerificationEmail,
} from '../index.js';
import { getFrontendBaseUrl } from './invoiceContext.js';

/**
 * Send welcome + verification emails after registration.
 * Must be awaited before the HTTP response on serverless (Vercel).
 * Failures are logged but do not block signup.
 */
export async function sendRegistrationEmails({ user, verificationToken }) {
    const baseUrl = getFrontendBaseUrl();
    const dashboardUrl = baseUrl;
    const verificationUrl = `${baseUrl}/verify-email/${verificationToken}`;

    const results = await Promise.allSettled([
        sendWelcomeEmail({
            to: user.email,
            userName: user.name,
            dashboardUrl,
        }),
        sendEmailVerificationEmail({
            to: user.email,
            userName: user.name,
            verificationUrl,
        }),
    ]);

    results.forEach((result, index) => {
        if (result.status === 'rejected') {
            const type = index === 0 ? 'welcome' : 'email-verification';
            console.error(`[Waraqah Email] Registration ${type} failed:`, result.reason);
        }
    });
}
