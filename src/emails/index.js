/**
 * Waraqah transactional email system (React Email + Resend).
 *
 * Controllers should import send functions from this module only —
 * never render HTML in route handlers.
 */
export { sendEmail, isEmailConfigured } from './sendEmail.js';
export { getEmailErrorMessage } from './errors.js';
export { PASSWORD_RESET_EXPIRY_MINUTES } from './config.js';

export {
    sendWelcomeEmail,
    sendPasswordResetEmail,
    sendEmailVerificationEmail,
    sendInvoiceEmail,
    sendReceiptEmail,
    sendPaymentConfirmationEmail,
    sendPaymentReminderEmail,
} from './senders/index.js';
