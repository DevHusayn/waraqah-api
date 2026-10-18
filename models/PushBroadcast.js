import mongoose from 'mongoose';

const pushBroadcastSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, default: 'product' },
    title: { type: String, default: '' },
    body: { type: String, default: '' },
    url: { type: String, default: '/' },
    audience: { type: String, default: 'all' },
    lastSentAt: { type: Date, default: null },
    sentCount: { type: Number, default: 0 },
    removedCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

export default mongoose.model('PushBroadcast', pushBroadcastSchema);
