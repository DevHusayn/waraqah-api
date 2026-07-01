import User from '../../../models/User.js';
import BusinessInfo from '../../../models/CompanyInfo.js';
import { getFrontendBaseUrl } from './invoiceContext.js';

/**
 * Load the Waraqah account owner for business activity notifications.
 */
export async function loadOwnerNotificationContext(userId) {
    const [user, businessInfo] = await Promise.all([
        User.findById(userId),
        BusinessInfo.findOne({ userId }),
    ]);

    if (!user?.email?.trim()) {
        const err = new Error('Owner email not found.');
        err.code = 'OWNER_EMAIL_NOT_FOUND';
        throw err;
    }

    return {
        to: user.email.trim().toLowerCase(),
        ownerName: user.name?.trim() || businessInfo?.name?.trim() || 'there',
        businessName: businessInfo?.name?.trim() || 'Your business',
    };
}

export function buildOwnerInvoiceUrl(invoiceId) {
    return `${getFrontendBaseUrl()}/invoices/${invoiceId}`;
}
