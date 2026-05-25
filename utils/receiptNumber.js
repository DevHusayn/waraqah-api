import { receiptFromInvoiceNumber } from './invoiceNumber.js';

/** @deprecated Receipt numbers are derived from invoice numbers — kept for API compatibility. */
export async function getNextReceiptNumber(userId) {
    const { getNextInvoiceNumber } = await import('./invoiceNumber.js');
    const nextInv = await getNextInvoiceNumber(userId);
    return receiptFromInvoiceNumber(nextInv);
}
