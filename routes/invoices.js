import express from 'express';
import Invoice from '../models/Invoice.js';
import auth from '../middleware/auth.js';
import { getInvoiceUsageForUser, assertCanCreateInvoice } from '../utils/invoiceLimits.js';

const router = express.Router();

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

// Create invoice
router.post('/', auth, async (req, res) => {
    try {
        await assertCanCreateInvoice(req.user.userId);
    } catch (err) {
        if (err.code === 'INVOICE_LIMIT_REACHED') {
            return res.status(403).json({
                message: err.message,
                code: err.code,
                usage: err.usage,
            });
        }
        throw err;
    }
    const invoice = await Invoice.create({ ...req.body, userId: req.user.userId });
    res.status(201).json(invoice);
});

// Update invoice
router.put('/:id', auth, async (req, res) => {
    const invoice = await Invoice.findOneAndUpdate(
        { _id: req.params.id, userId: req.user.userId },
        req.body,
        { new: true }
    );
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    res.json(invoice);
});

// Delete invoice
router.delete('/:id', auth, async (req, res) => {
    const invoice = await Invoice.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    res.json({ message: 'Invoice deleted' });
});

export default router;
