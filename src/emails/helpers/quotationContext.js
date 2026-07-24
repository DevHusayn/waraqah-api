import Client from '../../../models/Client.js';
import BusinessInfo from '../../../models/CompanyInfo.js';
import { ensureQuotationPublicToken } from '../../../utils/quotationPublicToken.js';
import { buildClientEmailBranding } from './clientEmailBranding.js';
import { getFrontendBaseUrl } from './invoiceContext.js';

/**
 * Public client-facing quotation URL. Never falls back to the private dashboard
 * path — clients must always land on /q/:token.
 */
export function buildQuotationUrl(quotation) {
    const token = typeof quotation === 'string' ? quotation : quotation?.publicToken;
    if (!token) {
        const err = new Error('Quotation public link is not available yet. Please try again.');
        err.status = 400;
        throw err;
    }
    return `${getFrontendBaseUrl()}/q/${encodeURIComponent(token)}`;
}

export function buildOwnerQuotationUrl(quotationOrId) {
    let id = quotationOrId;
    if (quotationOrId != null && typeof quotationOrId === 'object') {
        id = quotationOrId._id ?? quotationOrId.id;
    }
    if (id == null || id === '') {
        return `${getFrontendBaseUrl()}/quotations`;
    }
    return `${getFrontendBaseUrl()}/quotations/${id}`;
}

export async function loadQuotationEmailContext(quotation, userId) {
    await ensureQuotationPublicToken(quotation);

    const [client, businessInfo] = await Promise.all([
        quotation.clientId
            ? Client.findOne({ _id: quotation.clientId, userId })
            : null,
        BusinessInfo.findOne({ userId }),
    ]);

    if (!client?.email?.trim()) {
        const err = new Error('Client email is required to send this email.');
        err.status = 400;
        throw err;
    }

    const businessName = businessInfo?.name?.trim() || 'Your business';
    const branding = buildClientEmailBranding(businessInfo, businessName, {
        publicToken: quotation.publicToken,
        documentPath: 'quotations',
    });

    return {
        client,
        businessInfo,
        businessName,
        branding,
        to: client.email.trim().toLowerCase(),
        customerName: client.name || client.company || 'Customer',
    };
}
