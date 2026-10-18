import mongoose from 'mongoose';
import { LIFECYCLE_TEMPLATE_IDS } from '../utils/lifecycleEmails.js';

const STATUSES = ['pending', 'sent', 'skipped', 'cancelled'];

const adminFollowUpSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        templateId: { type: String, required: true, enum: LIFECYCLE_TEMPLATE_IDS },
        periodKey: { type: String, required: true, default: 'once' },
        status: { type: String, required: true, enum: STATUSES, default: 'pending', index: true },
        reason: { type: String, default: '' },
        source: { type: String, enum: ['queue', 'auto'], default: 'queue' },
        snoozeUntil: { type: Date, default: null },
        sentAt: { type: Date, default: null },
        skippedAt: { type: Date, default: null },
        cancelledAt: { type: Date, default: null },
        exitReason: { type: String, default: '' },
        actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true }
);

adminFollowUpSchema.index(
    { userId: 1, templateId: 1, periodKey: 1 },
    { unique: true, partialFilterExpression: { status: 'pending' } }
);
adminFollowUpSchema.index({ status: 1, snoozeUntil: 1, createdAt: -1 });
adminFollowUpSchema.index({ userId: 1, status: 1, createdAt: -1 });

export { STATUSES as ADMIN_FOLLOW_UP_STATUSES };
export default mongoose.model('AdminFollowUp', adminFollowUpSchema);
