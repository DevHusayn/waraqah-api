import BusinessInfo from '../../../models/CompanyInfo.js';
import { sendQuotationEmail } from '../senders/quotationEmail.js';
import { sendQuotationEmailedOwnerNotification } from '../senders/quotationEmailedOwnerNotification.js';
import {
    loadQuotationEmailContext,
    buildQuotationUrl,
    buildOwnerQuotationUrl,
} from './quotationContext.js';
import { ensureQuotationPublicToken } from '../../../utils/quotationPublicToken.js';
import { loadOwnerNotificationContext } from './ownerContext.js';

export async function shouldAutoEmailQuotations(userId) {
    const info = await BusinessInfo.findOne({ userId }).select('autoEmailInvoices');
    return Boolean(info?.autoEmailInvoices);
}

async function notifyOwnerQuotationEmailed({
    userId,
    quotation,
    clientEmail,
    customerName,
    automated = false,
}) {
    try {
        const owner = await loadOwnerNotificationContext(userId);
        await sendQuotationEmailedOwnerNotification({
            to: owner.to,
            ownerName: owner.ownerName,
            customerName,
            clientEmail,
            quotationNumber: quotation.quotationNumber,
            amount: quotation.total,
            currency: quotation.currency || 'NGN',
            validUntil: quotation.validUntil,
            quotationDashboardUrl: buildOwnerQuotationUrl(quotation),
            automated,
        });
    } catch (err) {
        console.error('[Waraqah Email] Owner quotation-emailed notification failed:', err?.message || err);
    }
}

export async function dispatchQuotationEmailToClient({
    quotation,
    userId,
    notifyOwner = true,
    automated = false,
}) {
    const publicToken = await ensureQuotationPublicToken(quotation);
    // Keep the in-memory doc in sync so branding + URL builders see the token.
    quotation.publicToken = publicToken;

    const ctx = await loadQuotationEmailContext(quotation, userId);
    const quotationUrl = buildQuotationUrl(quotation);

    await sendQuotationEmail({
        to: ctx.to,
        customerName: ctx.customerName,
        quotationNumber: quotation.quotationNumber,
        amount: quotation.total,
        currency: quotation.currency || 'NGN',
        validUntil: quotation.validUntil,
        quotationUrl,
        businessName: ctx.businessName,
        branding: ctx.branding,
    });

    quotation.clientQuotationEmailedAt = new Date();
    await quotation.save();

    if (notifyOwner) {
        await notifyOwnerQuotationEmailed({
            userId,
            quotation,
            clientEmail: ctx.to,
            customerName: ctx.customerName,
            automated,
        });
    }

    return { sentTo: ctx.to, publicUrl: quotationUrl };
}

export async function tryAutoEmailQuotation({ quotation, userId }) {
    if (quotation.status === 'draft' || !quotation.clientId) return null;
    if (!(await shouldAutoEmailQuotations(userId))) return null;

    try {
        return await dispatchQuotationEmailToClient({
            quotation,
            userId,
            notifyOwner: true,
            automated: true,
        });
    } catch (err) {
        console.error('[Waraqah Email] Auto-email quotation failed:', err.message);
        return null;
    }
}
