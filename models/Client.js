import mongoose from 'mongoose';

const clientSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: String,
    company: String,
    email: String,
    phone: String,
    address: String,
}, { timestamps: true });

clientSchema.index({ userId: 1, name: 1 });

export default mongoose.model('Client', clientSchema);
