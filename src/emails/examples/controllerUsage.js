/**
 * Example controller usage — routes must never contain HTML.
 * Copy patterns below into route handlers; keep rendering inside src/emails/.
 */

import {
    sendWelcomeEmail,
    sendPasswordResetEmail,
    sendEmailVerificationEmail,
    sendInvoiceEmail,
    sendReceiptEmail,
    sendPaymentConfirmationEmail,
    sendPaymentReminderEmail,
    getEmailErrorMessage,
} from '../index.js';

function getFrontendBaseUrl() {
    return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

// --- Auth: forgot password (already wired in routes/auth.js) ---
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

// --- Auth: email verification (call after register when verification is enabled) ---
export async function exampleSendVerification(user, verificationToken) {
    const verificationUrl = `${getFrontendBaseUrl()}/verify-email/${verificationToken}`;

    return sendEmailVerificationEmail({
        to: user.email,
        userName: user.name,
        verificationUrl,
    });
}

// --- Auth: welcome email after successful registration ---
export async function exampleWelcomeNewUser(user) {
    return sendWelcomeEmail({
        to: user.email,
        userName: user.name,
        dashboardUrl: `${getFrontendBaseUrl()}/dashboard`,
    });
}

// --- Invoices: send invoice to client ---
export async function exampleSendInvoiceToClient({ invoice, client, businessInfo }) {
    const invoiceUrl = `${getFrontendBaseUrl()}/invoices/${invoice._id}`;

    return sendInvoiceEmail({
        to: client.email,
        customerName: client.name,
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.total,
        currency: invoice.currency || 'NGN',
        dueDate: invoice.dueDate,
        invoiceUrl,
        businessName: businessInfo.name,
    });
}

// --- Payments: receipt after manual or gateway payment ---
export async function exampleSendReceipt({ invoice, client, businessInfo }) {
    return sendReceiptEmail({
        to: client.email,
        customerName: client.name,
        receiptNumber: invoice.receiptNumber,
        amountPaid: invoice.total,
        currency: invoice.currency || 'NGN',
        paymentDate: invoice.datePaid || new Date(),
        businessName: businessInfo.name,
    });
}

// --- Payments: confirmation after successful online payment ---
export async function examplePaymentConfirmed({ invoice, client, businessInfo, paymentMethod }) {
    return sendPaymentConfirmationEmail({
        to: client.email,
        customerName: client.name,
        invoiceNumber: invoice.invoiceNumber,
        amountPaid: invoice.total,
        currency: invoice.currency || 'NGN',
        paymentDate: invoice.datePaid || new Date(),
        paymentMethod,
        businessName: businessInfo.name,
        receiptUrl: `${getFrontendBaseUrl()}/receipts/${invoice.receiptNumber}`,
    });
}

// --- Invoices: payment reminder (cron or scheduled job) ---
export async function examplePaymentReminder({ invoice, client, businessInfo }) {
    const due = new Date(invoice.dueDate);
    const daysUntilDue = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

    return sendPaymentReminderEmail({
        to: client.email,
        customerName: client.name,
        invoiceNumber: invoice.invoiceNumber,
        amountOutstanding: invoice.total,
        currency: invoice.currency || 'NGN',
        dueDate: invoice.dueDate,
        daysUntilDue,
        invoiceUrl: `${getFrontendBaseUrl()}/invoices/${invoice._id}`,
        businessName: businessInfo.name,
    });
}
