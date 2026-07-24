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
            },
        ],
        notes: String,
        terms: { type: String, default: '' },
        status: { type: String, default: 'draft' },
        currency: String,
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

export default mongoose.model('Quotation', quotationSchema);
