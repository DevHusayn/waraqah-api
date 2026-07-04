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
    brandColor: { type: String, default: '#16A34A' },
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
    /** @deprecated use companyLogoUrl — kept for existing records */
    businessLogo: { type: String, default: '' },
    companyLogoUrl: { type: String, default: '' },
    /** JPEG data URL for sidebar / in-app avatar display */
    companyLogoAvatarUrl: { type: String, default: '' },
    companyStampUrl: { type: String, default: '' },
    authorizedSignatureUrl: { type: String, default: '' },
    paymentAccountName: { type: String, default: '' },
    paymentBankName: { type: String, default: '' },
    paymentAccountNumber: { type: String, default: '' },
    paymentInstructions: { type: String, default: '' },
    invoiceTemplateId: { type: String, default: 'classic' },
    /** Email invoice to client automatically when finalized (pending). */
    autoEmailInvoices: { type: Boolean, default: false },
    /** Email payment reminders automatically for due soon / overdue invoices. */
    autoPaymentReminders: { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.model('BusinessInfo', businessInfoSchema);
