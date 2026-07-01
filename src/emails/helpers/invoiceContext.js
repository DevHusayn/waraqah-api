import Client from '../../../models/Client.js';
import BusinessInfo from '../../../models/CompanyInfo.js';

export function getFrontendBaseUrl() {
    return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

export function buildInvoiceUrl(invoice) {
    const token = typeof invoice === 'string'
        ? invoice
        : invoice?.publicToken;
    if (token) {
        return `${getFrontendBaseUrl()}/i/${token}`;
    }
    const id = typeof invoice === 'object' ? invoice?._id || invoice?.id : invoice;
    return `${getFrontendBaseUrl()}/invoices/${id}`;
}

export function buildReceiptUrl(invoiceOrToken) {
    if (typeof invoiceOrToken === 'object' && invoiceOrToken?.publicToken) {
        return `${getFrontendBaseUrl()}/i/${invoiceOrToken.publicToken}?view=receipt`;
    }
    const receiptNumber = typeof invoiceOrToken === 'object'
        ? invoiceOrToken?.receiptNumber
        : invoiceOrToken;
    return `${getFrontendBaseUrl()}/invoices?receipt=${encodeURIComponent(receiptNumber || '')}`;
}

const PAYMENT_METHOD_LABELS = {
    cash: 'Cash',
    bank_transfer: 'Bank transfer',
    pos: 'POS',
    card: 'Card',
    online_gateway: 'Online payment',
};

export function formatPaymentMethod(method) {
    return PAYMENT_METHOD_LABELS[method] || method || 'Payment';
}

/**
 * Load client + business info needed for invoice-related emails.
 */
export async function loadInvoiceEmailContext(invoice, userId) {
    const [client, businessInfo] = await Promise.all([
        invoice.clientId
            ? Client.findOne({ _id: invoice.clientId, userId })
            : null,
        BusinessInfo.findOne({ userId }),
    ]);

    if (!client?.email?.trim()) {
        const err = new Error('Client email is required to send this email.');
        err.status = 400;
        throw err;
    }

    const businessName = businessInfo?.name?.trim() || 'Waraqah';

    return {
        client,
        businessInfo,
        businessName,
        to: client.email.trim().toLowerCase(),
        customerName: client.name || client.company || 'Customer',
    };
}

export function computeDaysUntilDue(dueDate) {
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}
