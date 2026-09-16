import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: false, default: null },
    /** Last known bill-to name; kept if the client record is later deleted. */
    clientName: { type: String, default: null },
    clientCompany: { type: String, default: null },
    /** invoice = bill for payment; receipt = standalone payment record (no invoice). */
    documentType: {
        type: String,
        enum: ['invoice', 'receipt'],
        default: 'invoice',
        index: true,
    },
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
            productId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Product',
                default: null,
            },
            /** Snapshot of product unit cost at document save time. */
            unitCost: { type: Number, default: undefined },
        }
    ],
    notes: String,
    /** Premium: custom thank-you footer on PDF (falls back to default when empty). */
    documentFooter: String,
    clientAdditionalInfo: String,
    status: { type: String, default: 'pending' },
    paymentMethod: {
        type: String,
        enum: ['cash', 'bank_transfer', 'pos', 'card', 'online_gateway'],
        required: false,
        default: undefined,
    },
    datePaid: { type: String, default: null },
    /** Sum of recorded installment payments. */
    amountPaid: { type: Number, default: 0 },
    payments: [
        {
            amount: { type: Number, required: true },
            method: {
                type: String,
                enum: ['cash', 'bank_transfer', 'pos', 'card', 'online_gateway'],
                required: true,
            },
            date: { type: String, required: true },
            note: { type: String, default: '' },
            createdAt: { type: Date, default: Date.now },
        },
    ],
    currency: String,
    /** Units of business currency per 1 document currency unit. 1 when they match. */
    exchangeRate: { type: Number, default: null },
    baseCurrency: { type: String, default: null },
    baseSubtotal: { type: Number, default: undefined },
    baseTax: { type: Number, default: undefined },
    baseDiscount: { type: Number, default: undefined },
    baseTotal: { type: Number, default: undefined },
    baseAmountPaid: { type: Number, default: 0 },
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
    recurringNextDate: { type: String, default: null },
    recurringSourceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Invoice',
        default: null,
    },
    lastPaymentReminderAt: { type: Date, default: null },
    /** Set when the invoice notification is emailed to the client. */
    clientInvoiceEmailedAt: { type: Date, default: null },
    /** Set when a standalone receipt is emailed to the client. */
    clientReceiptEmailedAt: { type: Date, default: null },
    /** Set when this invoice was created by converting a quotation (skips quota). */
    sourceQuotationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Quotation',
        default: null,
    },
}, { timestamps: true });

invoiceSchema.index({ userId: 1, createdAt: -1 });
invoiceSchema.index({ userId: 1, status: 1, dueDate: 1 });
invoiceSchema.index({ userId: 1, status: 1, createdAt: -1 });
invoiceSchema.index({ userId: 1, clientId: 1 });
invoiceSchema.index({ userId: 1, invoiceNumber: 1 }, { unique: true, sparse: true });
invoiceSchema.index({ userId: 1, receiptNumber: 1 }, { unique: true, sparse: true });
invoiceSchema.index({ userId: 1, status: 1 });
invoiceSchema.index({ status: 1, dueDate: 1 });
invoiceSchema.index({ isRecurring: 1, recurringNextDate: 1 });
invoiceSchema.index({ recurringSourceId: 1 });

export default mongoose.model('Invoice', invoiceSchema);
