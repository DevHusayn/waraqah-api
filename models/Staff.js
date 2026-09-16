import mongoose from 'mongoose';

const staffSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, required: true, trim: true, maxlength: 200 },
        role: { type: String, required: true, trim: true, maxlength: 80 },
        salary: { type: Number, required: true, min: 0 },
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
);

staffSchema.index({ userId: 1, name: 1 });
staffSchema.index({ userId: 1, isActive: 1, createdAt: -1 });

export default mongoose.model('Staff', staffSchema);
