import mongoose from 'mongoose';

const purchaseOrderSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        supplierId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Supplier',
            required: false,
            default: null,
        },
        purchaseOrderNumber: String,
        date: String,
        expectedDate: { type: String, default: null },
        items: [
            {
                description: String,
                quantity: Number,
                quantityReceived: { type: Number, default: 0 },
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
        status: {
            type: String,
            enum: ['draft', 'sent', 'partial', 'received', 'cancelled'],
            default: 'draft',
        },
        currency: String,
        exchangeRate: { type: Number, default: null },
        baseCurrency: { type: String, default: null },
        baseSubtotal: { type: Number, default: undefined },
        baseTotal: { type: Number, default: undefined },
        subtotal: Number,
        total: Number,
    },
    { timestamps: true }
);

purchaseOrderSchema.index({ userId: 1, createdAt: -1 });
purchaseOrderSchema.index({ userId: 1, status: 1, createdAt: -1 });
purchaseOrderSchema.index({ userId: 1, supplierId: 1 });
purchaseOrderSchema.index({ userId: 1, purchaseOrderNumber: 1 });

export default mongoose.model('PurchaseOrder', purchaseOrderSchema);
