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
import { getNextInvoiceNumber, peekNextInvoiceNumber } from '../utils/invoiceNumber.js';
import { getNextReceiptNumber, peekNextReceiptNumber } from '../utils/receiptNumber.js';
import {
    normalizeInvoicePayload,
    assignDocumentNumbers,
    isFinalizingDraft,
    isDraftStatus,
    assertInvoiceDeleteAllowed,
    stripPremiumDocumentFooter,
} from '../utils/invoiceValidation.js';
import {
    applyInvoicePayment,
    ensurePaymentLedger,
    getInvoiceAmountPaid,
    getInvoiceBalanceDue,
    syncFullPaymentFromMarkPaid,
} from '../utils/invoicePayments.js';
import { receiptFromInvoiceNumber } from '../utils/invoiceNumber.js';
import {
    sendReceiptEmail,
    sendPaymentReminderEmail,
    getEmailErrorMessage,
    dispatchInvoiceEmailToClient,
    tryAutoEmailInvoice,
    dispatchPaidInvoiceEmails,
    dispatchPartialPaymentEmails,
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
import { INVOICE_ONLY_FILTER } from '../utils/invoiceDocumentFilter.js';
import { countListSummary, buildSummaryResponse, resolveListSummaryOptions, isSummaryOnlyRequest, shouldFetchListSummary } from '../utils/listSummary.js';
import { getInvoiceStatusCounts } from '../utils/dashboardAnalytics.js';
import { getListPeriodMongoFilter } from '../utils/listMonthFilter.js';
import { applyListRecurringAndDateFilter } from '../utils/recurringListFilter.js';
import { sendInvoiceListExport } from '../utils/invoiceListExport.js';
import {
    applyInventoryTransition,
    checkStockWarnings,
    getAllowOverselling,
    withStockWarnings,
} from '../utils/inventory.js';
import { snapshotItemUnitCosts } from '../utils/itemCostSnapshot.js';
import { isUserPremium } from '../utils/premiumAccess.js';
import { stoppedRecurringFields } from '../utils/recurrence.js';
import { applyClientSnapshot, DOCUMENT_CLIENT_SEARCH_FIELDS } from '../utils/clientSnapshot.js';
import { attachClientNamesToDocuments, attachClientNamesToDocument } from '../utils/attachClientNames.js';
import { attachDocumentBaseAmounts } from '../utils/documentCurrency.js';

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

async function attachItemCostSnapshots(userId, payload) {
    if (!payload || !Array.isArray(payload.items)) return payload;
    payload.items = await snapshotItemUnitCosts(userId, payload.items);
    return payload;
}

function toUserObjectId(userId) {
    if (userId instanceof mongoose.Types.ObjectId) return userId;
    return new mongoose.Types.ObjectId(String(userId));
}

async function attachClientNames(invoices, userId) {
    return attachClientNamesToDocuments(invoices, userId);
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
router.get('/export', auth, asyncHandler(async (req, res) => {
    await sendInvoiceListExport(req, res);
}));

router.get('/', auth, asyncHandler(async (req, res) => {
    const userId = req.user.userId;

    if (isSummaryOnlyRequest(req.query)) {
        const listBase = { userId, status: { $ne: 'draft' }, ...INVOICE_ONLY_FILTER };
        const summaryOpts = await resolveListSummaryOptions(req, userId);
        const summaryCounts = await countListSummary(Invoice, listBase, summaryOpts);
        return res.json({
            summary: buildSummaryResponse('totalInvoices', summaryCounts.total, summaryCounts),
        });
    }

    const { page, limit, skip } = parsePagination(req);
    const status = String(req.query.status || 'all').trim().toLowerCase();
    const sortKey = String(req.query.sort || 'newest').trim();
    const sort = INVOICE_SORT[sortKey] || INVOICE_SORT.newest;
    const search = String(req.query.search || '').trim();
    const filter = { userId, status: { $ne: 'draft' }, ...INVOICE_ONLY_FILTER };
    if (status && status !== 'all') {
        filter.status = status;
    }
    const dateFilter = await getListPeriodMongoFilter(req.query, userId);
    applyListRecurringAndDateFilter(filter, {
        recurring: req.query.recurring,
        dateFilter,
    });

    if (search) {
        const clientIds = await resolveInvoiceSearchClientIds(userId, search);
        const textFilter = buildSearchFilter(search, [
            'invoiceNumber',
            'receiptNumber',
            ...DOCUMENT_CLIENT_SEARCH_FIELDS,
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

    const listBase = { userId, status: { $ne: 'draft' }, ...INVOICE_ONLY_FILTER };
    const includeSummary = shouldFetchListSummary(req.query);
    const summaryOpts = includeSummary ? await resolveListSummaryOptions(req, userId) : null;

    const [{ data, total }, statusCounts, summaryCounts] = await Promise.all([
        paginateFind(Invoice, filter, {
            skip,
            limit,
            sort,
            select: '-items -notes',
            lean: true,
        }),
        getInvoiceStatusCounts(userId, dateFilter || {}),
        includeSummary
            ? countListSummary(Invoice, listBase, summaryOpts)
            : Promise.resolve(null),
    ]);

    const withClients = await attachClientNames(data, userId);
    res.json({
        data: withClients,
        pagination: buildPaginationMeta(page, limit, total),
        statusCounts,
        ...(summaryCounts
            ? { summary: buildSummaryResponse('totalInvoices', summaryCounts.total, summaryCounts) }
            : {}),
    });
}));

// Paginated draft invoices
router.get('/drafts', auth, asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const { page, limit, skip } = parsePagination(req);
    const search = String(req.query.search || '').trim();

    const filter = { userId, status: 'draft', ...INVOICE_ONLY_FILTER };
    if (search) {
        const clientIds = await resolveInvoiceSearchClientIds(userId, search);
        const textFilter = buildSearchFilter(search, [
            'invoiceNumber',
            'receiptNumber',
            ...DOCUMENT_CLIENT_SEARCH_FIELDS,
        ]);
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
        const invoiceNumber = await peekNextInvoiceNumber(req.user.userId);
        res.json({ invoiceNumber });
    } catch (err) {
        res.status(500).json({ message: err.message || 'Could not preview invoice number' });
    }
});

// Next sequential receipt number for this user (RCP-0001, …)
router.get('/next-receipt-number', auth, async (req, res) => {
    try {
        const receiptNumber = await peekNextReceiptNumber(req.user.userId);
        res.json({ receiptNumber });
    } catch (err) {
        res.status(500).json({ message: err.message || 'Could not preview receipt number' });
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
        stripPremiumDocumentFooter(normalized, await isUserPremium(req.user.userId));
        await applyClientSnapshot(normalized, req.user.userId);
        const payload = await assignDocumentNumbers(
            normalized,
            null,
            req.user.userId,
            numberGenerators
        );
        attachPublicTokenIfNeeded(payload);
        await attachItemCostSnapshots(req.user.userId, payload);
        await attachDocumentBaseAmounts(req.user.userId, payload, {
            amountPaid: payload.amountPaid || 0,
        });
        const invoice = await Invoice.create({
            ...payload,
            userId: req.user.userId,
        });
        const allowOverselling = await getAllowOverselling(req.user.userId);
        const stockWarnings = allowOverselling
            ? await checkStockWarnings(req.user.userId, {
                prevDoc: null,
                nextDoc: invoice,
            })
            : [];
        await applyInventoryTransition({
            userId: req.user.userId,
            prevDoc: null,
            nextDoc: invoice,
            allowOverselling,
        });
        if (!isDraft) {
            await tryAutoEmailInvoice({ invoice, userId: req.user.userId });
        }
        res.status(201).json(withStockWarnings(invoice, stockWarnings));
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
    if (invoice.documentType === 'receipt') {
        return res.status(404).json({ message: 'Invoice not found' });
    }

    const needsBackfill =
        invoice.status === PAID &&
        (!(invoice.payments?.length) || invoice.amountPaid == null || Number(invoice.amountPaid) === 0);
    if (needsBackfill) {
        ensurePaymentLedger(invoice);
        await invoice.save();
    }

    res.json(await attachClientNamesToDocument(invoice, req.user.userId));
}));

// Record an installment payment (partial or full)
router.post('/:id/payments', auth, requireEmailVerified, validateObjectId(), async (req, res) => {
    try {
        const invoice = await Invoice.findOne({
            _id: req.params.id,
            userId: req.user.userId,
        });
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

        const { becamePaid, payment } = applyInvoicePayment(invoice, req.body);

        if (becamePaid) {
            const invNum = invoice.invoiceNumber;
            invoice.receiptNumber =
                invoice.receiptNumber || receiptFromInvoiceNumber(invNum);
            attachPublicTokenIfNeeded(invoice, invoice);
        }

        await invoice.save();

        if (becamePaid) {
            await dispatchPaidInvoiceEmails(invoice, req.user.userId);
        } else {
            await dispatchPartialPaymentEmails(invoice, req.user.userId, payment);
        }

        res.json(invoice);
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        console.error('Record payment error:', err);
        res.status(500).json({ message: err.message || 'Could not record payment' });
    }
});

// Update invoice
router.put('/:id', auth, requireEmailVerified, validateObjectId(), async (req, res) => {
    let reserved = false;
    try {
        const existing = await Invoice.findOne({
            _id: req.params.id,
            userId: req.user.userId,
        });
        if (!existing) return res.status(404).json({ message: 'Invoice not found' });
        if (existing.documentType === 'receipt') {
            return res.status(404).json({ message: 'Invoice not found' });
        }

        const normalized = normalizeInvoicePayload(req.body, { existing });
        stripPremiumDocumentFooter(normalized, await isUserPremium(req.user.userId));
        await applyClientSnapshot(normalized, req.user.userId, existing);
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

        // Legacy mark-as-paid via PUT: sync payments ledger for the remaining balance.
        const markingPaid =
            existing.status !== PAID && payload.status === PAID;
        if (markingPaid) {
            ensurePaymentLedger(existing);
            syncFullPaymentFromMarkPaid(existing, {
                paymentMethod: payload.paymentMethod,
                datePaid: payload.datePaid,
            });
            payload.amountPaid = existing.amountPaid;
            payload.payments = existing.payments;
            payload.paymentMethod = existing.paymentMethod;
            payload.datePaid = existing.datePaid;
            payload.status = PAID;
            payload.receiptNumber =
                existing.receiptNumber ||
                payload.receiptNumber ||
                receiptFromInvoiceNumber(existing.invoiceNumber || payload.invoiceNumber);
        }

        await attachItemCostSnapshots(req.user.userId, payload);
        await attachDocumentBaseAmounts(req.user.userId, payload, {
            amountPaid: payload.amountPaid ?? existing.amountPaid ?? 0,
        });

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

        const allowOverselling = await getAllowOverselling(req.user.userId);
        const stockWarnings = allowOverselling
            ? await checkStockWarnings(req.user.userId, {
                prevDoc: existing,
                nextDoc: invoice,
            })
            : [];
        await applyInventoryTransition({
            userId: req.user.userId,
            prevDoc: existing,
            nextDoc: invoice,
            allowOverselling,
        });

        res.json(withStockWarnings(invoice, stockWarnings));
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
        if (!['pending', 'partial', 'overdue'].includes(invoice.status)) {
            return res.status(400).json({
                message: 'Reminders can only be sent for pending, partial, or overdue invoices.',
            });
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
            amountOutstanding: getInvoiceBalanceDue(invoice),
            currency: invoice.currency || 'NGN',
            dueDate: invoice.dueDate,
            daysUntilDue,
            invoiceUrl: buildInvoiceUrl(invoice),
            businessName: ctx.businessName,
            replyTo: ctx.replyTo,
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
            amountPaid: getInvoiceAmountPaid(invoice) || invoice.total,
            currency: invoice.currency || 'NGN',
            paymentDate: invoice.datePaid || new Date(),
            paymentMethod: formatPaymentMethod(invoice.paymentMethod),
            businessName: ctx.businessName,
            replyTo: ctx.replyTo,
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

router.post('/:id/stop-recurring', auth, requireEmailVerified, validateObjectId(), async (req, res) => {
    try {
        const invoice = await Invoice.findOne({
            _id: req.params.id,
            userId: req.user.userId,
            ...INVOICE_ONLY_FILTER,
        });
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
        if (!invoice.isRecurring) {
            return res.status(400).json({ message: 'This invoice is not set to repeat.' });
        }

        invoice.set(stoppedRecurringFields());
        invoice.recurringFrequency = undefined;
        await invoice.save();
        res.json(invoice);
    } catch (err) {
        res.status(500).json({ message: err.message || 'Could not stop recurring invoice' });
    }
});

// Delete invoice
router.delete('/:id', auth, requireEmailVerified, validateObjectId(), asyncHandler(async (req, res) => {
    const invoice = await Invoice.findOne({ _id: req.params.id, userId: req.user.userId });
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    if (invoice.documentType === 'receipt') {
        return res.status(404).json({ message: 'Invoice not found' });
    }

    assertInvoiceDeleteAllowed(invoice);

    await applyInventoryTransition({
        userId: req.user.userId,
        prevDoc: invoice,
        nextDoc: null,
    });

    await Invoice.deleteOne({ _id: invoice._id });
    res.json({ message: 'Invoice deleted' });
}));

export default router;
