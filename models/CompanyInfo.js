import mongoose from 'mongoose';

const businessInfoSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    name: String,
    address: String,
    email: String,
    phone: String,
    website: String,
    defaultCurrency: { type: String, default: 'NGN' },
    taxRate: { type: Number, default: 10 },
    brandColor: { type: String, default: '#0ea5e9' },
    plan: { type: String, enum: ['free', 'premium'], default: 'free' },
    premiumUntil: { type: Date, default: null },
    subscriptionStatus: {
        type: String,
        enum: ['active', 'cancelled', 'non-renewing', 'attention', null],
        default: null,
    },
    paystackSubscriptionCode: { type: String, default: '' },
    paystackCustomerCode: { type: String, default: '' },
    paystackEmailToken: { type: String, default: '' },
    businessLogo: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('BusinessInfo', businessInfoSchema);
