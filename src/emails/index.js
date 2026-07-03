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
    sendInvoiceEmailedOwnerNotification,
    sendInvoicePaidOwnerNotification,
    sendInvoiceReminderSentOwnerNotification,
    sendInvoiceReceiptSentOwnerNotification,
    sendInvoiceCancelledClientEmail,
    sendInvoiceCancelledOwnerNotification,
    sendAccountSuspendedEmail,
    sendPremiumUpgradeSuccessEmail,
    sendPremiumPaymentFailedEmail,
    sendPremiumSubscriptionCancelledEmail,
} from './senders/index.js';

export {
    notifyOwnerInvoiceEmailed,
    notifyOwnerInvoicePaid,
    notifyOwnerInvoiceReminderSent,
    notifyOwnerInvoiceReceiptSent,
    notifyOwnerInvoiceCancelled,
} from './helpers/ownerNotifications.js';

export {
    notifyPremiumUpgradeSuccess,
    notifyPremiumPaymentFailed,
    notifyPremiumSubscriptionCancelled,
    notifyAccountSuspended,
} from './helpers/premiumNotifications.js';

export {
    dispatchInvoiceEmailToClient,
    tryAutoEmailInvoice,
    dispatchPaidInvoiceEmails,
    dispatchOverdueInvoiceEmails,
    dispatchCancelledInvoiceEmails,
} from './helpers/invoiceDispatch.js';
