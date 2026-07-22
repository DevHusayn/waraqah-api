import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: false, default: null },
    invoiceNumber: String,
    receiptNumber: String,
    /** Unguessable token for public client invoice view (no login). */
    publicToken: { type: String, unique: true, sparse: true, index: true },
    date: String,
    dueDate: String,
    items: [
        {
            description: String,
            quantity: Number,
            rate: Number,
            unit: { type: String, default: 'Qty' },
        }
    ],
    notes: String,
    status: { type: String, default: 'pending' },
    paymentMethod: {
        type: String,
        enum: ['cash', 'bank_transfer', 'pos', 'card', 'online_gateway'],
        required: false,
        default: undefined,
    },
    datePaid: { type: String, default: null },
    currency: String,
    taxRate: Number,
    discountType: { type: String, enum: ['fixed', 'percent'], default: 'fixed' },
    discountValue: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    subtotal: Number,
    tax: Number,
    total: Number,
    createdAt: { type: Date, default: Date.now },
    // Recurring invoice fields
    isRecurring: { type: Boolean, default: false },
    recurringFrequency: {
        type: String,
        enum: ['weekly', 'bi-weekly', 'monthly', 'quarterly', 'yearly'],
        required: false,
    },
    recurringEndDate: { type: String, default: null },
    lastPaymentReminderAt: { type: Date, default: null },
    /** Set when the invoice notification is emailed to the client. */
    clientInvoiceEmailedAt: { type: Date, default: null },
}, { timestamps: true });

invoiceSchema.index({ userId: 1, createdAt: -1 });
invoiceSchema.index({ userId: 1, status: 1, dueDate: 1 });
invoiceSchema.index({ userId: 1, status: 1, createdAt: -1 });

export default mongoose.model('Invoice', invoiceSchema);
