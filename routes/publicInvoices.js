import express from 'express';
import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';
import BusinessInfo from '../models/CompanyInfo.js';

const router = express.Router();

const HIDDEN_STATUSES = new Set(['draft', 'cancelled']);

function sanitizePublicClient(client) {
    if (!client) return null;
    return {
        name: client.name || '',
        company: client.company || '',
        address: client.address || '',
        phone: client.phone || '',
    };
}

function sanitizePublicBusiness(info) {
    if (!info) {
        return { name: 'Business' };
    }

    return {
        name: info.name || 'Business',
        address: info.address || '',
        email: info.email || '',
        phone: info.phone || '',
        website: info.website || '',
        companyLogoUrl: info.companyLogoUrl || info.companyLogoAvatarUrl || '',
        brandColor: info.brandColor || '#16A34A',
        paymentAccountName: info.paymentAccountName || '',
        paymentBankName: info.paymentBankName || '',
        paymentAccountNumber: info.paymentAccountNumber || '',
        paymentInstructions: info.paymentInstructions || '',
    };
}

function sanitizePublicInvoice(invoice) {
    return {
        invoiceNumber: invoice.invoiceNumber,
        receiptNumber: invoice.receiptNumber || null,
        status: invoice.status,
        date: invoice.date,
        dueDate: invoice.dueDate,
        datePaid: invoice.datePaid,
        paymentMethod: invoice.paymentMethod || null,
        items: (invoice.items || []).map((item) => ({
            description: item.description,
            quantity: item.quantity,
            rate: item.rate,
        })),
        notes: invoice.notes || '',
        currency: invoice.currency || 'NGN',
        taxRate: invoice.taxRate ?? 0,
        discountType: invoice.discountType || 'fixed',
        discountValue: invoice.discountValue ?? 0,
        discount: invoice.discount ?? 0,
        subtotal: invoice.subtotal ?? 0,
        tax: invoice.tax ?? 0,
        total: invoice.total ?? 0,
    };
}

/** Public invoice view — no authentication required. */
router.get('/invoices/:token', async (req, res) => {
    try {
        const token = String(req.params.token || '').trim();
        if (!token) {
            return res.status(400).json({ message: 'Invalid invoice link.' });
        }

        const invoice = await Invoice.findOne({ publicToken: token });
        if (!invoice || HIDDEN_STATUSES.has(invoice.status)) {
            return res.status(404).json({ message: 'This invoice link is invalid or no longer available.' });
        }

        const [client, businessInfo] = await Promise.all([
            invoice.clientId
                ? Client.findOne({ _id: invoice.clientId, userId: invoice.userId })
                : null,
            BusinessInfo.findOne({ userId: invoice.userId }),
        ]);

        res.json({
            invoice: sanitizePublicInvoice(invoice),
            client: sanitizePublicClient(client),
            business: sanitizePublicBusiness(businessInfo),
        });
    } catch (err) {
        console.error('Public invoice error:', err);
        res.status(500).json({ message: 'Could not load invoice.' });
    }
});

export default router;
