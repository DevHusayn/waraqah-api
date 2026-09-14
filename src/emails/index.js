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
    sendQuotationEmail,
    sendQuotationEmailedOwnerNotification,
    sendReceiptEmail,
    sendPaymentConfirmationEmail,
    sendPartialPaymentEmail,
    sendPaymentReminderEmail,
    sendInvoiceEmailedOwnerNotification,
    sendInvoicePaidOwnerNotification,
    sendInvoicePartialPaymentOwnerNotification,
    sendInvoiceReminderSentOwnerNotification,
    sendInvoiceReceiptSentOwnerNotification,
    sendInvoiceCancelledClientEmail,
    sendInvoiceCancelledOwnerNotification,
    sendAccountSuspendedEmail,
    sendAccountReactivatedEmail,
    sendNewUserAdminNotification,
    sendPremiumUpgradeSuccessEmail,
    sendPremiumGrantedByAdminEmail,
    sendPremiumPaymentFailedEmail,
    sendPremiumSubscriptionCancelledEmail,
    sendPremiumExpiryReminderEmail,
    sendLowStockAlertEmail,
    sendMonthlyStatementEmail,
    sendAdminMessageEmail,
    renderAdminMessageEmail,
} from './senders/index.js';

export {
    notifyOwnerInvoiceEmailed,
    notifyOwnerInvoicePaid,
    notifyOwnerInvoicePartialPayment,
    notifyOwnerInvoiceReminderSent,
    notifyOwnerInvoiceReceiptSent,
    notifyOwnerInvoiceCancelled,
} from './helpers/ownerNotifications.js';

export {
    notifyPremiumUpgradeSuccess,
    notifyPremiumGrantedByAdmin,
    notifyPremiumPaymentFailed,
    notifyPremiumSubscriptionCancelled,
    notifyAccountSuspended,
    notifyAccountReactivated,
} from './helpers/premiumNotifications.js';

export {
    dispatchInvoiceEmailToClient,
    tryAutoEmailInvoice,
    dispatchPaidInvoiceEmails,
    dispatchPartialPaymentEmails,
    dispatchOverdueInvoiceEmails,
    dispatchCancelledInvoiceEmails,
} from './helpers/invoiceDispatch.js';

export {
    dispatchQuotationEmailToClient,
    tryAutoEmailQuotation,
} from './helpers/quotationDispatch.js';

export {
    dispatchReceiptEmailToClient,
    tryAutoEmailReceipt,
} from './helpers/receiptDispatch.js';
