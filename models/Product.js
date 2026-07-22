import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    unitPrice: { type: Number, default: 0 },
}, { timestamps: true });

productSchema.index({ userId: 1, name: 1 });

export default mongoose.model('Product', productSchema);
