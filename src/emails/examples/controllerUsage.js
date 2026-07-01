/**
 * Example controller usage — routes must never contain HTML.
 * Copy patterns below into route handlers; keep rendering inside src/emails/.
 */

import {
    sendPasswordResetEmail,
    sendEmailVerificationEmail,
    getEmailErrorMessage,
    dispatchInvoiceEmailToClient,
    tryAutoEmailInvoice,
    notifyOwnerInvoiceReceiptSent,
    notifyPremiumUpgradeSuccess,
} from '../index.js';

function getFrontendBaseUrl() {
    return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

// --- Auth: forgot password (wired in routes/auth.js) ---
export async function exampleForgotPasswordHandler(user, token) {
    const resetUrl = `${getFrontendBaseUrl()}/reset-password/${token}`;

    try {
        await sendPasswordResetEmail({ to: user.email, resetUrl });
    } catch (mailErr) {
        console.error('Forgot-password email error:', mailErr);
        return { status: 503, message: getEmailErrorMessage(mailErr) };
    }

    return { status: 200, message: 'If an account exists, a reset link was sent.' };
}

// --- Auth: email verification (wired in routes/auth.js register + resend) ---
export async function exampleSendVerification(user, verificationToken) {
    const verificationUrl = `${getFrontendBaseUrl()}/verify-email/${verificationToken}`;

    return sendEmailVerificationEmail({
        to: user.email,
        userName: user.name,
        verificationUrl,
    });
}

// --- Invoices: manual send to client (wired via dispatchInvoiceEmailToClient) ---
export async function exampleSendInvoiceToClient({ invoice, userId }) {
    return dispatchInvoiceEmailToClient({
        invoice,
        userId,
        notifyOwner: true,
        automated: false,
    });
}

// --- Invoices: auto-email on finalize when autoEmailInvoices is enabled ---
export async function exampleAutoEmailOnFinalize({ invoice, userId }) {
    return tryAutoEmailInvoice({ invoice, userId });
}

// --- Invoices: manual receipt resend + owner notification ---
export async function exampleReceiptResent({ invoice, userId, clientEmail, customerName }) {
    notifyOwnerInvoiceReceiptSent({
        userId,
        invoice,
        clientEmail,
        customerName,
    });
}

// --- Premium: first successful payment ---
export async function examplePremiumActivated(userId) {
    notifyPremiumUpgradeSuccess(userId);
}
