import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reference: { type: String, required: true, unique: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'NGN' },
    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
    type: { type: String, enum: ['one_time', 'subscription'], default: 'subscription' },
    paystackSubscriptionCode: { type: String, default: '' },
    channel: { type: String, default: '' },
    paidAt: { type: Date, default: null },
}, { timestamps: true });

export default mongoose.model('Payment', paymentSchema);
