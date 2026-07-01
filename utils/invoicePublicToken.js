import crypto from 'crypto';

export function createPublicToken() {
    return crypto.randomBytes(24).toString('base64url');
}

/**
 * Assign a stable public share token for non-draft invoices.
 */
export async function ensureInvoicePublicToken(invoice) {
    if (invoice.publicToken) return invoice.publicToken;

    invoice.publicToken = createPublicToken();
    await invoice.save();
    return invoice.publicToken;
}

export function attachPublicTokenIfNeeded(payload, existing = null) {
    const status = payload.status ?? existing?.status ?? 'pending';
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
