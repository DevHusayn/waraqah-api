
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import BusinessInfo from '../models/CompanyInfo.js';
import auth from '../middleware/auth.js';
import { defaultBusinessInfoFields, PLANS, toBusinessInfoResponse } from '../utils/businessInfoHelpers.js';
import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';
import { sendPasswordResetEmail } from '../utils/email.js';
import { isStrongPassword, PASSWORD_REQUIREMENTS_MESSAGE } from '../utils/passwordValidation.js';
import { createPasswordResetToken, hashPasswordResetToken } from '../utils/resetToken.js';

const router = express.Router();

const FORGOT_PASSWORD_RESPONSE = {
    message: 'If an account exists for that email, we sent a link to reset your password.',
};

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function getFrontendBaseUrl() {
    const url = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    return url;
}

// Admin: Suspend/Activate user
router.patch('/admin/users/:id/status', auth, async (req, res) => {
    try {
        const adminUser = await User.findById(req.user.userId);
        if (!adminUser || !adminUser.isAdmin) return res.status(403).json({ message: 'Forbidden: Admins only' });
        if (req.user.userId === req.params.id) return res.status(400).json({ message: 'You cannot change your own status.' });
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        user.status = user.status === 'active' ? 'suspended' : 'active';
        await user.save();
        res.json({ message: 'User status updated', status: user.status });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// Admin: Promote/Demote user
router.patch('/admin/users/:id/admin', auth, async (req, res) => {
    try {
        const adminUser = await User.findById(req.user.userId);
        if (!adminUser || !adminUser.isAdmin) return res.status(403).json({ message: 'Forbidden: Admins only' });
        if (req.user.userId === req.params.id) return res.status(400).json({ message: 'You cannot change your own admin status.' });
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        user.isAdmin = !user.isAdmin;
        await user.save();
        res.json({ message: 'User admin status updated', isAdmin: user.isAdmin });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// Admin: Delete user
router.delete('/admin/users/:id', auth, async (req, res) => {
    try {
        const adminUser = await User.findById(req.user.userId);
        if (!adminUser || !adminUser.isAdmin) return res.status(403).json({ message: 'Forbidden: Admins only' });
        if (req.user.userId === req.params.id) return res.status(400).json({ message: 'You cannot delete yourself.' });
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        // Optionally, delete related business info, invoices, clients
        await BusinessInfo.deleteOne({ userId: req.params.id });
        await Invoice.deleteMany({ userId: req.params.id });
        await Client.deleteMany({ userId: req.params.id });
        res.json({ message: 'User deleted' });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

router.get('/admin/users', auth, async (req, res) => {
    try {
        const adminUser = await User.findById(req.user.userId);
        if (!adminUser || !adminUser.isAdmin) {
            return res.status(403).json({ message: 'Forbidden: Admins only' });
        }
        const users = await User.find({}, '-password');
        const businessInfos = await BusinessInfo.find({});

        // Get invoice and client counts for each user
        const invoiceCounts = await Invoice.aggregate([
            { $group: { _id: '$userId', count: { $sum: 1 } } }
        ]);
        const clientCounts = await Client.aggregate([
            { $group: { _id: '$userId', count: { $sum: 1 } } }
        ]);

        const usersWithDetails = users.map(user => {
            const businessInfo = businessInfos.find(bi => bi.userId.toString() === user._id.toString()) || null;
            const invoiceCount = invoiceCounts.find(ic => ic._id.toString() === user._id.toString())?.count || 0;
            const clientCount = clientCounts.find(cc => cc._id.toString() === user._id.toString())?.count || 0;
            return {
                ...user.toObject(),
                businessInfo,
                invoiceCount,
                clientCount,
            };
        });
        res.json(usersWithDetails);
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// Register
router.post('/register', async (req, res) => {
    try {
        const { email, password, name, businessInfo } = req.body;
        if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
        const existing = await User.findOne({ email });
        if (existing) return res.status(409).json({ message: 'Email already registered' });
        const hash = await bcrypt.hash(password, 10);
        const user = await User.create({ email, password: hash, name });
        // Save business info if provided (ensure all fields are present)
        await BusinessInfo.create({
            userId: user._id,
            ...defaultBusinessInfoFields,
            ...(businessInfo ? {
                name: businessInfo.name || '',
                address: businessInfo.address || '',
                email: businessInfo.email || '',
                phone: businessInfo.phone || '',
                website: businessInfo.website || '',
                brandColor: businessInfo.brandColor || defaultBusinessInfoFields.brandColor,
                taxRate: businessInfo.taxRate ?? defaultBusinessInfoFields.taxRate,
            } : {}),
        });
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({
            message: 'User registered',
            token,
            user: { id: user._id, email: user.email, name: user.name, isAdmin: user.isAdmin, status: user.status },
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// Login

// Rate limiting and lockout config
const MAX_ATTEMPTS = 5;
const LOCK_TIME = 15 * 60 * 1000; // 15 minutes

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(401).json({ message: 'Invalid credentials' });

        if (user.status === 'suspended') {
            return res.status(403).json({ message: 'Account suspended. Contact support.' });
        }

        // Check lockout
        if (user.lockUntil && user.lockUntil > Date.now()) {
            return res.status(423).json({ message: `Account locked. Try again after ${new Date(user.lockUntil).toLocaleTimeString()}` });
        }

        // Check password
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
            // Lock account if too many attempts
            if (user.failedLoginAttempts >= MAX_ATTEMPTS) {
                user.lockUntil = Date.now() + LOCK_TIME;
                await user.save();
                return res.status(423).json({ message: `Account locked due to too many failed attempts. Try again after ${new Date(user.lockUntil).toLocaleTimeString()}` });
            } else {
                await user.save();
            }
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Reset failed attempts and lock
        user.failedLoginAttempts = 0;
        user.lockUntil = undefined;
        user.lastLogin = new Date();
        await user.save();
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user._id, email: user.email, name: user.name, isAdmin: user.isAdmin, status: user.status, lastLogin: user.lastLogin } });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// Password reset request (send token)
router.post('/forgot-password', async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        if (!email) {
            return res.status(400).json({ message: 'Email is required.' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(200).json(FORGOT_PASSWORD_RESPONSE);
        }

        const token = createPasswordResetToken();
        user.passwordResetToken = hashPasswordResetToken(token);
        user.passwordResetExpires = Date.now() + 60 * 60 * 1000;
        await user.save();

        const resetUrl = `${getFrontendBaseUrl()}/reset-password/${token}`;

        try {
            await sendPasswordResetEmail({ to: user.email, resetUrl });
        } catch (mailErr) {
            console.error('Forgot-password email error:', mailErr);
            if (mailErr.code === 'EMAIL_NOT_CONFIGURED') {
                return res.status(503).json({
                    message: 'Password reset email is not available right now. Please contact support.',
                });
            }
            return res.status(503).json({
                message: 'We could not send the reset email. Please try again in a few minutes.',
            });
        }

        res.status(200).json(FORGOT_PASSWORD_RESPONSE);
    } catch (err) {
        console.error('Forgot-password error:', err);
        res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }
});

// Password reset (set new password)
router.post('/reset-password/:token', async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({ message: 'Password is required.' });
        }
        if (!isStrongPassword(password)) {
            return res.status(400).json({ message: PASSWORD_REQUIREMENTS_MESSAGE });
        }

        const tokenHash = hashPasswordResetToken(req.params.token);
        const user = await User.findOne({
            passwordResetToken: tokenHash,
            passwordResetExpires: { $gt: Date.now() },
        });

        if (!user) {
            return res.status(400).json({
                message: 'This reset link is invalid or has expired. Request a new one from the sign-in page.',
            });
        }

        user.password = await bcrypt.hash(password, 10);
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        user.failedLoginAttempts = 0;
        user.lockUntil = undefined;
        await user.save();

        res.json({ message: 'Your password has been updated. You can sign in now.' });
    } catch (err) {
        console.error('Reset-password error:', err);
        res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }
});

// Admin: set user plan (free | premium)
router.patch('/admin/users/:id/plan', auth, async (req, res) => {
    try {
        const adminUser = await User.findById(req.user.userId);
        if (!adminUser || !adminUser.isAdmin) {
            return res.status(403).json({ message: 'Forbidden: Admins only' });
        }
        const { plan } = req.body;
        if (![PLANS.FREE, PLANS.PREMIUM].includes(plan)) {
            return res.status(400).json({ message: 'Plan must be "free" or "premium"' });
        }
        let info = await BusinessInfo.findOne({ userId: req.params.id });
        if (!info) {
            info = await BusinessInfo.create({
                userId: req.params.id,
                ...defaultBusinessInfoFields,
                plan,
                premiumUntil: plan === PLANS.PREMIUM
                    ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                    : null,
            });
        } else {
            info.plan = plan;
            if (plan === PLANS.PREMIUM) {
                info.premiumUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            } else {
                info.premiumUntil = null;
                info.businessLogo = '';
            }
            await info.save();
        }
        res.json({ message: 'Plan updated', businessInfo: toBusinessInfoResponse(info) });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// Admin unlock user
router.patch('/admin/users/:id/unlock', auth, async (req, res) => {
    try {
        const adminUser = await User.findById(req.user.userId);
        if (!adminUser || !adminUser.isAdmin) return res.status(403).json({ message: 'Forbidden: Admins only' });
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        user.failedLoginAttempts = 0;
        user.lockUntil = undefined;
        await user.save();
        res.json({ message: 'User account unlocked.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

export default router;
