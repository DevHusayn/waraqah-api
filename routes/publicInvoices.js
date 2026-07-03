import express from 'express';
import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';
import BusinessInfo from '../models/CompanyInfo.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { isPremiumActive, PLANS } from '../utils/businessInfoHelpers.js';

const router = express.Router();

const HIDDEN_STATUSES = new Set(['draft', 'cancelled']);

function resolveCompanyLogo(info) {
    return (info.companyLogoUrl || info.businessLogo || '').trim();
}

function sanitizePublicClient(client) {
    if (!client) return null;
    return {
        name: client.name || '',
        company: client.company || '',
        address: client.address || '',
        phone: client.phone || '',
        email: client.email || '',
    };
}

function sanitizePublicBusiness(info) {
    if (!info) {
        return {
            name: 'Business',
            brandColor: '#16A34A',
            plan: PLANS.FREE,
            premiumUntil: null,
        };
    }

    const o = typeof info.toObject === 'function' ? info.toObject() : info;
    const premium = isPremiumActive(o);
    const plan = premium ? PLANS.PREMIUM : PLANS.FREE;
    const logo = premium ? resolveCompanyLogo(o) : '';

    return {
        name: o.name || 'Business',
        address: o.address || '',
        email: o.email || '',
        phone: o.phone || '',
        website: o.website || '',
        brandColor: o.brandColor || '#16A34A',
        plan,
        premiumUntil: premium && o.premiumUntil ? o.premiumUntil : null,
        businessLogo: logo,
        companyLogoUrl: logo,
        companyStampUrl: premium ? (o.companyStampUrl || '').trim() : '',
        authorizedSignatureUrl: premium ? (o.authorizedSignatureUrl || '').trim() : '',
        paymentAccountName: o.paymentAccountName || '',
        paymentBankName: o.paymentBankName || '',
        paymentAccountNumber: o.paymentAccountNumber || '',
        paymentInstructions: o.paymentInstructions || '',
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
router.get('/invoices/:token', asyncHandler(async (req, res) => {
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
}));

export default router;
