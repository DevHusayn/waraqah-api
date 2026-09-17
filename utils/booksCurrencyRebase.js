import mongoose from 'mongoose';
import BusinessInfo from '../models/CompanyInfo.js';
import Expense from '../models/Expense.js';
import Invoice from '../models/Invoice.js';
import Product from '../models/Product.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Quotation from '../models/Quotation.js';
import Staff from '../models/Staff.js';
import { isValidExchangeRate, rebaseDocumentBooks, correctDocumentBooksRate, booksRebaseCorrectionFactor } from './documentCurrency.js';
import { normalizeCurrency } from './locale.js';

function toUserObjectId(userId) {
    if (userId instanceof mongoose.Types.ObjectId) return userId;
    return new mongoose.Types.ObjectId(String(userId));
}

function sessionOptions(session) {
    return session ? { session } : {};
}

function isTransactionUnsupported(err) {
    return (
        err?.code === 20 ||
        err?.codeName === 'IllegalOperation' ||
        /transaction numbers are only allowed/i.test(err?.message || '') ||
        /replica set/i.test(err?.message || '')
    );
}

async function withOptionalTransaction(work) {
    if (mongoose.connection.readyState !== 1) {
        return work(null);
    }

    const session = await mongoose.startSession();
    let startedTransaction = false;
    try {
        try {
            // Capture the callback result ourselves. Returning a Mongoose document
            // from session.withTransaction() is unreliable (documents are thenable,
            // and the doc is tied to a session that we end in `finally`).
            let result;
            await session.withTransaction(async () => {
                startedTransaction = true;
                result = await work(session);
            });
            return result;
        } catch (err) {
            if (startedTransaction || !isTransactionUnsupported(err)) throw err;
            return work(null);
        }
    } finally {
        await session.endSession();
    }
}

function toBulkOps(docs, { fromCurrency, toCurrency, rate, kind }) {
    const ops = [];
    for (const doc of docs) {
        const patch = rebaseDocumentBooks(doc, { fromCurrency, toCurrency, rate, kind });
        if (!patch) continue;
        ops.push({
            updateOne: {
                filter: { _id: doc._id },
                update: { $set: patch },
            },
        });
    }
    return ops;
}

async function bulkWriteInChunks(Model, ops, session) {
    if (!ops.length) return;
    const options = sessionOptions(session);
    const chunkSize = 500;
    for (let i = 0; i < ops.length; i += chunkSize) {
        await Model.bulkWrite(ops.slice(i, i + chunkSize), options);
    }
}

async function rebaseDocuments(Model, userId, session, rebase, kind) {
    const query = Model.find({ userId }).lean();
    if (session) query.session(session);
    const docs = await query;
    await bulkWriteInChunks(Model, toBulkOps(docs, { ...rebase, kind }), session);
}

function createdAtOrBefore(cutoff) {
    const at = cutoff instanceof Date ? cutoff : new Date(cutoff);
    return {
        $or: [
            { createdAt: { $lte: at } },
            { createdAt: { $exists: false } },
            { createdAt: null },
        ],
    };
}

function toCorrectionOps(docs, args) {
    const ops = [];
    for (const doc of docs) {
        const patch = correctDocumentBooksRate(doc, args);
        if (!patch) continue;
        ops.push({
            updateOne: {
                filter: { _id: doc._id },
                update: { $set: patch },
            },
        });
    }
    return ops;
}

async function correctDocuments(Model, filter, session, args) {
    const query = Model.find(filter).lean();
    if (session) query.session(session);
    const docs = await query;
    await bulkWriteInChunks(Model, toCorrectionOps(docs, args), session);
}

export async function userHasBooksAmounts(userId, session = null) {
    const uid = toUserObjectId(userId);
    const exists = (Model) => {
        const query = Model.exists({ userId: uid });
        if (session) query.session(session);
        return query;
    };
    const found = await Promise.all([
        exists(Invoice),
        exists(Quotation),
        exists(PurchaseOrder),
        exists(Expense),
        exists(Staff),
        exists(Product),
    ]);
    return found.some(Boolean);
}

/**
 * Convert all operating-currency amounts for a user into `toCurrency`.
 * Client-facing document currencies and Paystack charges are left unchanged.
 */
export async function rebaseUserBooksCurrency(
    userId,
    { fromCurrency, toCurrency, rate, session = null } = {}
) {
    const from = normalizeCurrency(fromCurrency);
    const to = normalizeCurrency(toCurrency);
    const rebaseRate = Number(rate);
    if (from === to) return { from, to, rate: 1, skipped: true };
    if (!isValidExchangeRate(rebaseRate)) {
        const err = new Error(`Enter how many ${to} equal 1 ${from}.`);
        err.status = 400;
        throw err;
    }

    const uid = toUserObjectId(userId);
    const rebase = { fromCurrency: from, toCurrency: to, rate: rebaseRate };
    const opts = sessionOptions(session);

    await rebaseDocuments(Invoice, uid, session, rebase, 'invoice');
    await rebaseDocuments(Quotation, uid, session, rebase, 'quotation');
    await rebaseDocuments(PurchaseOrder, uid, session, rebase, 'purchaseOrder');

    await Promise.all([
        Expense.updateMany({ userId: uid }, { $mul: { amount: rebaseRate } }, opts),
        Staff.updateMany({ userId: uid }, { $mul: { salary: rebaseRate } }, opts),
        Product.updateMany(
            { userId: uid },
            { $mul: { unitPrice: rebaseRate, unitCost: rebaseRate } },
            opts
        ),
    ]);

    return { from, to, rate: rebaseRate, skipped: false };
}

/**
 * Restate amounts converted in the last books switch by newRate / oldRate.
 * Records created after that conversion are left unchanged.
 */
export async function correctUserBooksRebaseRate(
    userId,
    { fromCurrency, toCurrency, oldRate, newRate, rebasedAt, session = null } = {}
) {
    const from = normalizeCurrency(fromCurrency);
    const to = normalizeCurrency(toCurrency);
    const factor = booksRebaseCorrectionFactor(oldRate, newRate);
    if (from === to) return { from, to, oldRate, newRate, factor: 1, skipped: true };
    if (factor == null) {
        const err = new Error(`Enter how many ${to} equal 1 ${from}.`);
        err.status = 400;
        throw err;
    }
    if (factor === 1) return { from, to, oldRate, newRate, factor: 1, skipped: true };

    const uid = toUserObjectId(userId);
    const cutoff = new Date(rebasedAt);
    if (Number.isNaN(cutoff.getTime())) {
        const err = new Error('This books conversion can no longer be corrected.');
        err.status = 400;
        throw err;
    }

    const filter = { userId: uid, ...createdAtOrBefore(cutoff) };
    const args = { fromCurrency: from, toCurrency: to, oldRate, newRate };
    const opts = sessionOptions(session);

    await correctDocuments(Invoice, filter, session, { ...args, kind: 'invoice' });
    await correctDocuments(Quotation, filter, session, { ...args, kind: 'quotation' });
    await correctDocuments(PurchaseOrder, filter, session, { ...args, kind: 'purchaseOrder' });

    await Promise.all([
        Expense.updateMany(filter, { $mul: { amount: factor } }, opts),
        Staff.updateMany(filter, { $mul: { salary: factor } }, opts),
        Product.updateMany(
            filter,
            { $mul: { unitPrice: factor, unitCost: factor } },
            opts
        ),
    ]);

    return { from, to, oldRate, newRate, factor, skipped: false };
}

export async function persistBusinessCurrencyChange(userId, updates, rebase, correction) {
    const uid = toUserObjectId(userId);

    const apply = async (session) => {
        if (rebase) {
            await rebaseUserBooksCurrency(userId, { ...rebase, session });
            updates.booksRebasedAt = new Date();
            updates.booksRebaseFrom = rebase.fromCurrency;
            updates.booksRebaseTo = rebase.toCurrency;
            updates.booksRebaseRate = Number(rebase.rate);
        } else if (correction) {
            await correctUserBooksRebaseRate(userId, { ...correction, session });
            updates.booksRebaseRate = Number(correction.newRate);
            updates.booksRebaseCorrectedAt = new Date();
        }
        await BusinessInfo.updateOne(
            { userId: uid },
            { $set: updates },
            sessionOptions(session)
        );
    };

    if (rebase || correction) {
        await withOptionalTransaction(apply);
    } else {
        await apply(null);
    }

    // Always re-read outside the transaction. A document returned from
    // findOneAndUpdate({ session }) can serialize as empty after endSession().
    return BusinessInfo.findOne({ userId: uid });
}
