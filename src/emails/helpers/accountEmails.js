import {
    sendWelcomeEmail,
    sendEmailVerificationEmail,
    sendNewUserAdminNotification,
} from '../index.js';
import { getAdminNotifyEmail } from '../config.js';
import { getFrontendBaseUrl } from './invoiceContext.js';

/**
 * Notify the platform admin about a new signup.
 * Failures are logged but never block signup.
 */
export async function notifyAdminNewUser({ user, businessName, signupMethod = 'email' }) {
    try {
        if (!user?.email?.trim()) return;

        const adminTo = getAdminNotifyEmail();
        if (!adminTo) return;

        await sendNewUserAdminNotification({
            to: adminTo,
            userName: user.name,
            userEmail: user.email.trim().toLowerCase(),
            businessName,
            signupMethod,
            signedUpAt: user.createdAt || new Date(),
            adminDashboardUrl: `${getFrontendBaseUrl()}/admin`,
        });
    } catch (err) {
        console.error('[Waraqah Email] Admin new-user notification failed:', err?.message || err);
    }
}

/**
 * Send welcome + verification emails after registration.
 * Must be awaited before the HTTP response on serverless (Vercel).
 * Failures are logged but do not block signup.
 */
export async function sendRegistrationEmails({ user, verificationToken, businessName }) {
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
        notifyAdminNewUser({
            user,
            businessName,
            signupMethod: 'email',
        }),
    ]);

    results.forEach((result, index) => {
        if (result.status === 'rejected') {
            const type = ['welcome', 'email-verification', 'admin-new-user'][index];
            console.error(`[Waraqah Email] Registration ${type} failed:`, result.reason);
        }
    });
}
