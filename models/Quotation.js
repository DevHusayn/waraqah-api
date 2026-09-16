import mongoose from 'mongoose';

const quotationSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        clientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Client',
            required: false,
            default: null,
        },
        /** Last known bill-to name; kept if the client record is later deleted. */
        clientName: { type: String, default: null },
        clientCompany: { type: String, default: null },
        quotationNumber: String,
        publicToken: { type: String, unique: true, sparse: true, index: true },
        date: String,
        validUntil: { type: String, default: null },
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
            },
        ],
        notes: String,
        /** Premium: custom thank-you footer on PDF (falls back to default when empty). */
        documentFooter: String,
        clientAdditionalInfo: String,
        terms: { type: String, default: '' },
        status: { type: String, default: 'draft' },
        currency: String,
        exchangeRate: { type: Number, default: null },
        baseCurrency: { type: String, default: null },
        baseSubtotal: { type: Number, default: undefined },
        baseTax: { type: Number, default: undefined },
        baseDiscount: { type: Number, default: undefined },
        baseTotal: { type: Number, default: undefined },
        taxRate: Number,
        discountType: { type: String, enum: ['fixed', 'percent'], default: 'fixed' },
        discountValue: { type: Number, default: 0 },
        discount: { type: Number, default: 0 },
        subtotal: Number,
        tax: Number,
        total: Number,
        convertedInvoiceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Invoice',
            default: null,
        },
        convertedAt: { type: Date, default: null },
        clientQuotationEmailedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

quotationSchema.index({ userId: 1, createdAt: -1 });
quotationSchema.index({ userId: 1, status: 1, validUntil: 1 });
quotationSchema.index({ userId: 1, status: 1, createdAt: -1 });
quotationSchema.index({ userId: 1, clientId: 1 });
quotationSchema.index({ userId: 1, quotationNumber: 1 });
quotationSchema.index({ userId: 1, status: 1 });

export default mongoose.model('Quotation', quotationSchema);
