import mongoose from 'mongoose';

const businessInfoSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    name: String,
    address: String,
    email: String,
    phone: String,
    website: String,
    defaultCurrency: { type: String, default: 'NGN' },
    /** ISO 3166-1 alpha-2 country used to suggest default currency. */
    country: { type: String, default: 'NG' },
    /** IANA timezone for business reporting (monthly stats, statements). */
    timezone: { type: String, default: 'Africa/Lagos' },
    taxRate: { type: Number, default: 10 },
    brandColor: { type: String, default: '#16A34A' },
    /** Premium: default thank-you footer prefilled on new invoices, quotations, and receipts. */
    defaultDocumentFooter: { type: String, default: '' },
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
    billingInterval: { type: String, enum: ['monthly', 'yearly', null], default: null },
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
    /** Email owner a daily digest when tracked products are low on stock or out of stock. */
    lowStockEmailAlerts: { type: Boolean, default: false },
    /** Allow issuing documents that would push tracked stock below zero. Default off. */
    allowOverselling: { type: Boolean, default: false },
    /** Update product unit cost using weighted average when PO stock is received. */
    autoUpdateCostFromPO: { type: Boolean, default: false },
    /** Last low-stock digest sent to the owner (max one email per 24 hours). */
    lowStockEmailLastSentAt: { type: Date, default: null },
    /** Email the owner their monthly billing statement PDF (Premium). Default on. */
    autoEmailMonthlyStatements: { type: Boolean, default: true },
    /** Period key "YYYY-MM" for the last automated monthly statement email. */
    monthlyStatementLastSentFor: { type: String, default: null },
    /** premiumUntil value this expiry reminder was sent for (avoids duplicate sends). */
    premiumExpiryReminderForUntil: { type: Date, default: null },
}, { timestamps: true });

businessInfoSchema.index({ paystackSubscriptionCode: 1 }, { sparse: true });

export default mongoose.model('BusinessInfo', businessInfoSchema);
