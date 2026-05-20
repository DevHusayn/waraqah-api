import Invoice from '../models/Invoice.js';

const PREFIX = 'INV';

/**
 * Next sequential invoice number per user: INV-0001, INV-0002, …
 */
export async function getNextInvoiceNumber(userId) {
    const invoices = await Invoice.find({ userId }).select('invoiceNumber').lean();
    let max = 0;

    for (const inv of invoices) {
        const raw = String(inv.invoiceNumber || '');
        const match = raw.match(new RegExp(`^${PREFIX}-(\\d+)$`, 'i'));
        if (match) {
            max = Math.max(max, parseInt(match[1], 10));
        }
    }

    const next = max + 1;
    return `${PREFIX}-${String(next).padStart(4, '0')}`;
}
