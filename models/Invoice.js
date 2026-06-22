import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    invoiceNumber: String,
    receiptNumber: String,
    date: String,
    dueDate: String,
    items: [
        {
            description: String,
            quantity: Number,
            rate: Number,
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
    recurringFrequency: { type: String, enum: ['weekly', 'bi-weekly', 'monthly', 'quarterly', 'yearly'], default: null },
    recurringEndDate: { type: String, default: null },
}, { timestamps: true });

export default mongoose.model('Invoice', invoiceSchema);
