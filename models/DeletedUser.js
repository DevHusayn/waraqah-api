import mongoose from 'mongoose';

const deletedUserSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
        email: { type: String, default: '' },
        name: { type: String, default: '' },
        status: { type: String, default: '' },
        isAdmin: { type: Boolean, default: false },
        deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: { createdAt: 'deletedAt', updatedAt: false } }
);

deletedUserSchema.index({ deletedAt: -1 });

export default mongoose.model('DeletedUser', deletedUserSchema);
