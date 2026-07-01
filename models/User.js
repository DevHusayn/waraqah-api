import mongoose from 'mongoose';




const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String },
    isAdmin: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    lastLogin: { type: Date },
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    passwordResetToken: { type: String },
    passwordResetExpires: { type: Date },
    passwordResetRequestedAt: { type: Date },
    /** Legacy accounts without this field are treated as verified in route logic. */
    emailVerified: { type: Boolean, default: true },
    emailVerificationToken: { type: String },
    emailVerificationExpires: { type: Date },
    emailVerificationSentAt: { type: Date },
}, { timestamps: true });

export default mongoose.model('User', userSchema);
