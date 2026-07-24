/**
 * Backfill amountPaid + payments[] for legacy invoices.
 *
 * Usage (from InvoicePro-backend):
 *   node scripts/backfillInvoicePayments.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import { ensurePaymentLedger } from '../utils/invoicePayments.js';

async function main() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
        console.error('Missing MONGODB_URI (or MONGO_URI) in environment.');
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log('Connected. Scanning invoices…');

    const cursor = Invoice.find({
        $or: [
            { status: 'paid', $or: [{ payments: { $exists: false } }, { payments: { $size: 0 } }, { amountPaid: { $in: [null, 0] } }] },
            { amountPaid: { $exists: false } },
        ],
    }).cursor();

    let updated = 0;
    let scanned = 0;

    for await (const invoice of cursor) {
        scanned += 1;
        const before = JSON.stringify({
            amountPaid: invoice.amountPaid,
            paymentsLen: invoice.payments?.length || 0,
        });
        ensurePaymentLedger(invoice);
        if (invoice.amountPaid == null) {
            invoice.amountPaid = 0;
        }
        if (!Array.isArray(invoice.payments)) {
            invoice.payments = [];
        }
        const after = JSON.stringify({
            amountPaid: invoice.amountPaid,
            paymentsLen: invoice.payments?.length || 0,
        });
        if (before !== after || invoice.isModified()) {
            await invoice.save();
            updated += 1;
        }
    }

    console.log(`Done. Scanned ${scanned}, updated ${updated}.`);
    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error(err);
    try {
        await mongoose.disconnect();
    } catch {
        /* ignore */
    }
    process.exit(1);
});
