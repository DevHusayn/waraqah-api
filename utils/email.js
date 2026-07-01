/**
 * @deprecated Import from `src/emails/index.js` directly in new code.
 * Thin compatibility layer for existing route imports.
 */
export {
    sendPasswordResetEmail,
    getEmailErrorMessage,
    isEmailConfigured,
    PASSWORD_RESET_EXPIRY_MINUTES,
} from '../src/emails/index.js';
