import { createPublicToken } from './invoicePublicToken.js';

/**
 * Assign a stable public share token for non-draft quotations.
 */
export async function ensureQuotationPublicToken(quotation) {
    if (quotation.publicToken) return quotation.publicToken;

    quotation.publicToken = createPublicToken();
    await quotation.save();
    return quotation.publicToken;
}

export function attachQuotationPublicTokenIfNeeded(payload, existing = null) {
    const status = payload.status ?? existing?.status ?? 'sent';
    if (status === 'draft') {
        delete payload.publicToken;
        return payload;
    }

    if (existing?.publicToken) {
        payload.publicToken = existing.publicToken;
        return payload;
    }

    if (!payload.publicToken) {
        payload.publicToken = createPublicToken();
    }

    return payload;
}
