import express from 'express';
import Invoice from '../models/Invoice.js';
import auth from '../middleware/auth.js';
import {
    getInvoiceUsageForUser,
    reserveInvoiceCreation,
    releaseInvoiceCreation,
} from '../utils/invoiceLimits.js';
import { getNextInvoiceNumber } from '../utils/invoiceNumber.js';
import { getNextReceiptNumber } from '../utils/receiptNumber.js';
import { normalizeInvoicePayload, assignDocumentNumbers } from '../utils/invoiceValidation.js';

const router = express.Router();

const numberGenerators = {
    getNextInvoiceNumber,
    getNextReceiptNumber,
};

// Monthly invoice quota (free plan)
router.get('/usage', auth, async (req, res) => {
    try {
        const usage = await getInvoiceUsageForUser(req.user.userId);
        res.json(usage);
    } catch (err) {
        res.status(500).json({ message: err.message || 'Could not load invoice usage' });
    }
});

// Get all invoices for user
router.get('/', auth, async (req, res) => {
    const invoices = await Invoice.find({ userId: req.user.userId });
    res.json(invoices);
});

// Next sequential invoice number for this user (INV-0001, …)
router.get('/next-number', auth, async (req, res) => {
    try {
        const invoiceNumber = await getNextInvoiceNumber(req.user.userId);
        res.json({ invoiceNumber });
    } catch (err) {
        res.status(500).json({ message: err.message || 'Could not generate invoice number' });
    }
});

// Next sequential receipt number for this user (RCP-0001, …)
router.get('/next-receipt-number', auth, async (req, res) => {
    try {
        const receiptNumber = await getNextReceiptNumber(req.user.userId);
        res.json({ receiptNumber });
    } catch (err) {
        res.status(500).json({ message: err.message || 'Could not generate receipt number' });
    }
});

// Create invoice
router.post('/', auth, async (req, res) => {
    let reserved = false;
    try {
        await reserveInvoiceCreation(req.user.userId);
        reserved = true;
        const normalized = normalizeInvoicePayload(req.body, { isCreate: true });
        const payload = await assignDocumentNumbers(
            normalized,
            null,
            req.user.userId,
            numberGenerators
        );
        const invoice = await Invoice.create({
            ...payload,
            userId: req.user.userId,
        });
        res.status(201).json(invoice);
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        if (err.code === 'INVOICE_LIMIT_REACHED') {
            return res.status(403).json({
                message: err.message,
                code: err.code,
                usage: err.usage,
            });
        }
        if (reserved) {
            await releaseInvoiceCreation(req.user.userId);
        }
        res.status(500).json({ message: err.message || 'Could not create invoice' });
    }
});

// Update invoice
router.put('/:id', auth, async (req, res) => {
    try {
        const existing = await Invoice.findOne({
            _id: req.params.id,
            userId: req.user.userId,
        });
        if (!existing) return res.status(404).json({ message: 'Invoice not found' });

        const normalized = normalizeInvoicePayload(req.body, { existing });
        const payload = await assignDocumentNumbers(
            normalized,
            existing,
            req.user.userId,
            numberGenerators
        );

        const invoice = await Invoice.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.userId },
            payload,
            { new: true }
        );
        res.json(invoice);
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        res.status(500).json({ message: err.message || 'Could not update invoice' });
    }
});

// Delete invoice
router.delete('/:id', auth, async (req, res) => {
    const invoice = await Invoice.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    res.json({ message: 'Invoice deleted' });
});

export default router;
