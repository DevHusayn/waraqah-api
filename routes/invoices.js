import express from 'express';
import Invoice from '../models/Invoice.js';
import auth from '../middleware/auth.js';
import requireEmailVerified from '../middleware/requireEmailVerified.js';
import validateObjectId from '../middleware/validateObjectId.js';
import {
    getInvoiceUsageForUser,
    reserveInvoiceCreation,
    releaseInvoiceCreation,
} from '../utils/invoiceLimits.js';
import { getNextInvoiceNumber } from '../utils/invoiceNumber.js';
import { getNextReceiptNumber } from '../utils/receiptNumber.js';
import {
    normalizeInvoicePayload,
    assignDocumentNumbers,
    isFinalizingDraft,
    isDraftStatus,
    assertInvoiceDeleteAllowed,
} from '../utils/invoiceValidation.js';
import {
    sendReceiptEmail,
    sendPaymentReminderEmail,
    getEmailErrorMessage,
    dispatchInvoiceEmailToClient,
    tryAutoEmailInvoice,
    dispatchPaidInvoiceEmails,
    dispatchOverdueInvoiceEmails,
    dispatchCancelledInvoiceEmails,
    notifyOwnerInvoiceReminderSent,
    notifyOwnerInvoiceReceiptSent,
} from '../src/emails/index.js';
import { PAYMENT_REMINDER_COOLDOWN_MS, PAYMENT_REMINDER_MIN_DAYS_BETWEEN, getNextPaymentReminderDate } from '../src/emails/config.js';
import {
    loadInvoiceEmailContext,
    buildInvoiceUrl,
    buildReceiptUrl,
    formatPaymentMethod,
    computeDaysUntilDue,
} from '../src/emails/helpers/invoiceContext.js';
import { attachPublicTokenIfNeeded, ensureInvoicePublicToken } from '../utils/invoicePublicToken.js';
import { syncOverdueInvoicesForUser } from '../utils/invoiceOverdue.js';
import asyncHandler from '../middleware/asyncHandler.js';

const router = express.Router();

const PAID = 'paid';

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
router.get('/', auth, asyncHandler(async (req, res) => {
    await syncOverdueInvoicesForUser(req.user.userId);
    const invoices = await Invoice.find({ userId: req.user.userId }).lean();
    res.json(invoices);
}));

// Draft invoices only
router.get('/drafts', auth, asyncHandler(async (req, res) => {
    const drafts = await Invoice.find({ userId: req.user.userId, status: 'draft' }).sort({
        updatedAt: -1,
    });
    res.json(drafts);
}));

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

// Create invoice or draft
router.post('/', auth, requireEmailVerified, async (req, res) => {
    let reserved = false;
    const isDraft = isDraftStatus(req.body?.status);
    try {
        if (!isDraft) {
            await reserveInvoiceCreation(req.user.userId);
            reserved = true;
        }
        const normalized = normalizeInvoicePayload(req.body, { isCreate: true });
        const payload = await assignDocumentNumbers(
            normalized,
            null,
            req.user.userId,
            numberGenerators
        );
        attachPublicTokenIfNeeded(payload);
        const invoice = await Invoice.create({
            ...payload,
            userId: req.user.userId,
        });
        if (!isDraft) {
            await tryAutoEmailInvoice({ invoice, userId: req.user.userId });
        }
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

// Get single invoice
router.get('/:id', auth, validateObjectId(), asyncHandler(async (req, res) => {
    const invoice = await Invoice.findOne({
        _id: req.params.id,
        userId: req.user.userId,
    });
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    res.json(invoice);
}));

// Update invoice
router.put('/:id', auth, requireEmailVerified, validateObjectId(), async (req, res) => {
    let reserved = false;
    try {
        const existing = await Invoice.findOne({
            _id: req.params.id,
            userId: req.user.userId,
        });
        if (!existing) return res.status(404).json({ message: 'Invoice not found' });

        const normalized = normalizeInvoicePayload(req.body, { existing });
        if (isFinalizingDraft(existing, normalized)) {
            await reserveInvoiceCreation(req.user.userId);
            reserved = true;
        }

        const payload = await assignDocumentNumbers(
            normalized,
            existing,
            req.user.userId,
            numberGenerators
        );

        attachPublicTokenIfNeeded(payload, existing);

        const invoice = await Invoice.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.userId },
            payload,
            { new: true }
        );

        const wasPaid =
            existing.status !== PAID &&
            invoice.status === PAID;
        const becameOverdue =
            existing.status !== 'overdue' &&
            invoice.status === 'overdue';
        const becameCancelled =
            existing.status !== 'cancelled' &&
            invoice.status === 'cancelled';
        const finalized = isFinalizingDraft(existing, normalized);

        if (wasPaid) {
            await dispatchPaidInvoiceEmails(invoice, req.user.userId);
        }
        if (becameOverdue) {
            await dispatchOverdueInvoiceEmails({ invoice, userId: req.user.userId });
        }
        if (becameCancelled) {
            await dispatchCancelledInvoiceEmails({ invoice, userId: req.user.userId });
        }
        if (finalized) {
            await tryAutoEmailInvoice({ invoice, userId: req.user.userId });
        }

        res.json(invoice);
    } catch (err) {
        if (reserved) {
            await releaseInvoiceCreation(req.user.userId);
        }
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
        res.status(500).json({ message: err.message || 'Could not update invoice' });
    }
});

// Email invoice to client
router.post('/:id/send-email', auth, requireEmailVerified, validateObjectId(), async (req, res) => {
    try {
        const invoice = await Invoice.findOne({
            _id: req.params.id,
            userId: req.user.userId,
        });
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
        if (invoice.status === 'draft') {
            return res.status(400).json({ message: 'Finalize the invoice before emailing it to a client.' });
        }

        const result = await dispatchInvoiceEmailToClient({
            invoice,
            userId: req.user.userId,
            notifyOwner: true,
            automated: false,
        });

        res.json({
            message: 'Invoice email sent.',
            sentTo: result.sentTo,
            publicUrl: result.publicUrl,
        });
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        console.error('Send invoice email error:', err);
        return res.status(503).json({ message: getEmailErrorMessage(err) });
    }
});

// Send payment reminder to client
router.post('/:id/send-reminder', auth, requireEmailVerified, validateObjectId(), async (req, res) => {
    try {
        const invoice = await Invoice.findOne({
            _id: req.params.id,
            userId: req.user.userId,
        });
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
        if (!['pending', 'overdue'].includes(invoice.status)) {
            return res.status(400).json({ message: 'Reminders can only be sent for pending or overdue invoices.' });
        }

        const lastReminder = invoice.lastPaymentReminderAt?.getTime() || 0;
        if (Date.now() - lastReminder < PAYMENT_REMINDER_COOLDOWN_MS) {
            const nextDate = getNextPaymentReminderDate(invoice.lastPaymentReminderAt);
            const nextLabel = nextDate ? ` after ${nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : '';
            return res.status(429).json({
                message: `A reminder was already sent within the last ${PAYMENT_REMINDER_MIN_DAYS_BETWEEN} days. You can send another${nextLabel}.`,
            });
        }

        await ensureInvoicePublicToken(invoice);
        const ctx = await loadInvoiceEmailContext(invoice, req.user.userId);
        const daysUntilDue = computeDaysUntilDue(invoice.dueDate);

        await sendPaymentReminderEmail({
            to: ctx.to,
            customerName: ctx.customerName,
            invoiceNumber: invoice.invoiceNumber,
            amountOutstanding: invoice.total,
            currency: invoice.currency || 'NGN',
            dueDate: invoice.dueDate,
            daysUntilDue,
            invoiceUrl: buildInvoiceUrl(invoice),
            businessName: ctx.businessName,
            branding: ctx.branding,
        });

        invoice.lastPaymentReminderAt = new Date();
        await invoice.save();

        await notifyOwnerInvoiceReminderSent({
            userId: req.user.userId,
            invoice,
            clientEmail: ctx.to,
            customerName: ctx.customerName,
            daysUntilDue,
            automated: false,
        });

        res.json({
            message: 'Payment reminder sent.',
            sentTo: ctx.to,
            lastPaymentReminderAt: invoice.lastPaymentReminderAt,
        });
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        console.error('Send payment reminder error:', err);
        return res.status(503).json({ message: getEmailErrorMessage(err) });
    }
});

// Resend receipt to client (paid invoices only)
router.post('/:id/send-receipt', auth, requireEmailVerified, validateObjectId(), async (req, res) => {
    try {
        const invoice = await Invoice.findOne({
            _id: req.params.id,
            userId: req.user.userId,
        });
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
        if (invoice.status !== PAID) {
            return res.status(400).json({ message: 'Receipts can only be sent for paid invoices.' });
        }
        if (!invoice.receiptNumber) {
            return res.status(400).json({ message: 'This invoice does not have a receipt number.' });
        }

        await ensureInvoicePublicToken(invoice);
        const ctx = await loadInvoiceEmailContext(invoice, req.user.userId);

        await sendReceiptEmail({
            to: ctx.to,
            customerName: ctx.customerName,
            invoiceNumber: invoice.invoiceNumber,
            receiptNumber: invoice.receiptNumber,
            amountPaid: invoice.total,
            currency: invoice.currency || 'NGN',
            paymentDate: invoice.datePaid || new Date(),
            paymentMethod: formatPaymentMethod(invoice.paymentMethod),
            businessName: ctx.businessName,
            branding: ctx.branding,
            receiptUrl: buildReceiptUrl(invoice),
        });

        await notifyOwnerInvoiceReceiptSent({
            userId: req.user.userId,
            invoice,
            clientEmail: ctx.to,
            customerName: ctx.customerName,
        });

        res.json({ message: 'Receipt email sent.', sentTo: ctx.to });
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        console.error('Send receipt email error:', err);
        return res.status(503).json({ message: getEmailErrorMessage(err) });
    }
});

// Delete invoice
router.delete('/:id', auth, requireEmailVerified, validateObjectId(), asyncHandler(async (req, res) => {
    const invoice = await Invoice.findOne({ _id: req.params.id, userId: req.user.userId });
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    assertInvoiceDeleteAllowed(invoice);

    await Invoice.deleteOne({ _id: invoice._id });
    res.json({ message: 'Invoice deleted' });
}));

export default router;
