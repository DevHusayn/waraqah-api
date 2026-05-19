import mongoose from 'mongoose';

const monthlyInvoiceUsageSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        periodKey: { type: String, required: true }, // YYYY-MM in UTC
        count: { type: Number, default: 0, min: 0 },
    },
    { timestamps: true }
);

monthlyInvoiceUsageSchema.index({ userId: 1, periodKey: 1 }, { unique: true });

export default mongoose.model('MonthlyInvoiceUsage', monthlyInvoiceUsageSchema);
