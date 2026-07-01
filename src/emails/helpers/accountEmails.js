import {
    sendWelcomeEmail,
    sendEmailVerificationEmail,
} from '../index.js';
import { getFrontendBaseUrl } from './invoiceContext.js';

/**
 * Fire-and-forget welcome + verification emails after registration.
 * Failures are logged but do not block signup.
 */
export function sendRegistrationEmails({ user, verificationToken }) {
    const baseUrl = getFrontendBaseUrl();
    const dashboardUrl = baseUrl;
    const verificationUrl = `${baseUrl}/verify-email/${verificationToken}`;

    Promise.allSettled([
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
    ]).then((results) => {
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                const type = index === 0 ? 'welcome' : 'email-verification';
                console.error(`[Waraqah Email] Registration ${type} failed:`, result.reason);
            }
        });
    });
}
