import Quotation from '../models/Quotation.js';

const QTN_PREFIX = 'QTN';

/** Extract numeric suffix from QTN-0001 style strings. */
export function extractQuotationSequence(raw) {
    const match = String(raw || '').match(/^QTN-(\d+)$/i);
    return match ? parseInt(match[1], 10) : 0;
}

/**
 * Next sequential quotation number per user: QTN-0001, QTN-0002, …
 */
export async function getNextQuotationNumber(userId) {
    const quotations = await Quotation.find({ userId }).select('quotationNumber').lean();
    let max = 0;

    for (const q of quotations) {
        max = Math.max(max, extractQuotationSequence(q.quotationNumber));
    }

    const next = max + 1;
    return `${QTN_PREFIX}-${String(next).padStart(4, '0')}`;
}

export { QTN_PREFIX };
