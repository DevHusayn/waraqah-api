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
import { getDashboardForUser, getInvoiceMetaForUser } from '../utils/dashboardStats.js';
import asyncHandler from '../middleware/asyncHandler.js';
import Client from '../models/Client.js';
import mongoose from 'mongoose';
import {
    parsePagination,
    paginateFind,
    buildPaginationMeta,
    buildSearchFilter,
    escapeRegex,
} from '../utils/pagination.js';

const router = express.Router();

const PAID = 'paid';

const INVOICE_SORT = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    dueDate: { dueDate: 1 },
    amountHigh: { total: -1 },
    amountLow: { total: 1 },
};

const numberGenerators = {
    getNextInvoiceNumber,
    getNextReceiptNumber,
};

function toUserObjectId(userId) {
    if (userId instanceof mongoose.Types.ObjectId) return userId;
    return new mongoose.Types.ObjectId(String(userId));
}

async function attachClientNames(invoices, userId) {
    const clientIds = [
        ...new Set(
            invoices
                .map((inv) => inv.clientId)
                .filter(Boolean)
                .map((id) => String(id))
        ),
    ];
    if (clientIds.length === 0) {
        return invoices.map((inv) => ({ ...inv, clientName: null }));
    }
    const clients = await Client.find({
        userId,
        _id: { $in: clientIds },
    })
        .select('name company')
        .lean();
    const byId = new Map(clients.map((c) => [String(c._id), c]));
    return invoices.map((inv) => {
        const client = inv.clientId ? byId.get(String(inv.clientId)) : null;
        return {
            ...inv,
            clientName: client?.name || null,
            clientCompany: client?.company || null,
        };
    });
}

async function getInvoiceStatusCounts(userId) {
    const uid = toUserObjectId(userId);
    const rows = await Invoice.aggregate([
        { $match: { userId: uid, status: { $ne: 'draft' } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const statusCounts = { all: 0, pending: 0, paid: 0, overdue: 0, cancelled: 0 };
    for (const row of rows) {
        const key = row._id;
        if (key && Object.prototype.hasOwnProperty.call(statusCounts, key)) {
            statusCounts[key] = row.count;
        }
        statusCounts.all += row.count;
    }
    return statusCounts;
}

async function resolveInvoiceSearchClientIds(userId, search) {
    const q = String(search || '').trim();
    if (!q) return [];
    const regex = new RegExp(escapeRegex(q), 'i');
    const clients = await Client.find({
        userId,
        $or: [{ name: regex }, { company: regex }, { email: regex }],
    })
        .select('_id')
        .lean();
    return clients.map((c) => c._id);
}

// Monthly invoice quota (free plan)
router.get('/usage', auth, async (req, res) => {
    try {
        const usage = await getInvoiceUsageForUser(req.user.userId);
        res.json(usage);
    } catch (err) {
        res.status(500).json({ message: err.message || 'Could not load invoice usage' });
    }
});

// Dashboard overview (stats + recent + overdue — no full list)
router.get('/dashboard', auth, asyncHandler(async (req, res) => {
    const dashboard = await getDashboardForUser(req.user.userId);
    res.json(dashboard);
}));

// App shell metadata (draft badge, etc.)
router.get('/meta', auth, asyncHandler(async (req, res) => {
    const meta = await getInvoiceMetaForUser(req.user.userId);
    res.json(meta);
}));

// Paginated invoice list (non-drafts) — line items loaded on detail/edit
router.get('/', auth, asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const { page, limit, skip } = parsePagination(req);
    const status = String(req.query.status || 'all').trim().toLowerCase();
    const sortKey = String(req.query.sort || 'newest').trim();
    const sort = INVOICE_SORT[sortKey] || INVOICE_SORT.newest;
    const search = String(req.query.search || '').trim();
    const year = Number.parseInt(String(req.query.year || ''), 10);
    const month = Number.parseInt(String(req.query.month || ''), 10);

    const filter = { userId, status: { $ne: 'draft' } };
    if (status && status !== 'all') {
        filter.status = status;
    }

    if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
        const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
        const nextMonth = month === 12 ? 1 : month + 1;
        const nextYear = month === 12 ? year + 1 : year;
        const endStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
        filter.date = { $gte: startStr, $lt: endStr };
    }

    if (search) {
        const clientIds = await resolveInvoiceSearchClientIds(userId, search);
        const textFilter = buildSearchFilter(search, [
            'invoiceNumber',
            'receiptNumber',
        ]);
        const or = [...(textFilter?.$or || [])];
        if (clientIds.length > 0) {
            or.push({ clientId: { $in: clientIds } });
        }
        // Also match total as string-ish via regex on stringified number is awkward;
        // keep number/receipt + client name search as primary.
        if (or.length > 0) {
            filter.$or = or;
        }
    }

    const [{ data, total }, statusCounts] = await Promise.all([
        paginateFind(Invoice, filter, {
            skip,
            limit,
            sort,
            select: '-items -notes',
            lean: true,
        }),
        getInvoiceStatusCounts(userId),
    ]);

    const withClients = await attachClientNames(data, userId);
    res.json({
        data: withClients,
        pagination: buildPaginationMeta(page, limit, total),
        statusCounts,
    });
}));

// Paginated draft invoices
router.get('/drafts', auth, asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const { page, limit, skip } = parsePagination(req);
    const search = String(req.query.search || '').trim();

    const filter = { userId, status: 'draft' };
    if (search) {
        const clientIds = await resolveInvoiceSearchClientIds(userId, search);
        const textFilter = buildSearchFilter(search, ['invoiceNumber', 'receiptNumber']);
        const or = [...(textFilter?.$or || [])];
        if (clientIds.length > 0) {
            or.push({ clientId: { $in: clientIds } });
        }
        if (or.length > 0) {
            filter.$or = or;
        }
    }

    const { data, total } = await paginateFind(Invoice, filter, {
        skip,
        limit,
        sort: { updatedAt: -1 },
        select: '-items -notes',
        lean: true,
    });

    const withClients = await attachClientNames(data, userId);
    res.json({
        data: withClients,
        pagination: buildPaginationMeta(page, limit, total),
    });
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
