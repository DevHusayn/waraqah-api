
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import BusinessInfo from '../models/CompanyInfo.js';
import auth from '../middleware/auth.js';
import validateObjectId from '../middleware/validateObjectId.js';
import { defaultBusinessInfoFields, PLANS, toBusinessInfoResponse } from '../utils/businessInfoHelpers.js';
import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';
import {
    getInvoiceUsageForUser,
    getInvoiceUsageMapForUsers,
    resetFreeInvoiceUsageForUser,
} from '../utils/invoiceLimits.js';
import { sendPasswordResetEmail, getEmailErrorMessage } from '../utils/email.js';
import { isStrongPassword, PASSWORD_REQUIREMENTS_MESSAGE } from '../utils/passwordValidation.js';
import { createPasswordResetToken, hashPasswordResetToken } from '../utils/resetToken.js';
import { sendServerError } from '../utils/apiError.js';
import { JWT_EXPIRY } from '../utils/jwtConfig.js';
import {
    loginLimiter,
    registerLimiter,
    forgotPasswordLimiter,
    resetPasswordLimiter,
} from '../middleware/rateLimits.js';
import {
    sanitizePlainText,
    sanitizeOptionalEmail,
    sanitizeHexColor,
    sanitizeNumber,
} from '../utils/sanitize.js';
import { setAuthCookies, clearAuthCookies, getTokenFromRequest } from '../utils/authCookie.js';

const router = express.Router();

const FORGOT_PASSWORD_RESPONSE = {
    message: 'If an account exists for that email, we sent a link to reset your password.',
};

/** Minimum time between reset emails to the same account (Gmail rate limits) */
const RESET_EMAIL_COOLDOWN_MS = 2 * 60 * 1000;

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function toPublicUser(user, extra = {}) {
    return {
        id: user._id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
        status: user.status,
        ...extra,
    };
}

function getFrontendBaseUrl() {
    const url = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    return url;
}

// Admin: Suspend/Activate user
router.patch('/admin/users/:id/status', auth, validateObjectId(), async (req, res) => {
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
        return sendServerError(res, err);
    }
});

// Admin: Promote/Demote user
router.patch('/admin/users/:id/admin', auth, validateObjectId(), async (req, res) => {
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
        return sendServerError(res, err);
    }
});

// Admin: Delete user
router.delete('/admin/users/:id', auth, validateObjectId(), async (req, res) => {
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
        return sendServerError(res, err);
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

        const invoiceUsageByUser = await getInvoiceUsageMapForUsers(users.map((u) => u._id));

        const usersWithDetails = users.map((user) => {
            const businessInfo =
                businessInfos.find((bi) => bi.userId.toString() === user._id.toString()) || null;
            const invoiceCount =
                invoiceCounts.find((ic) => ic._id.toString() === user._id.toString())?.count || 0;
            const clientCount =
                clientCounts.find((cc) => cc._id.toString() === user._id.toString())?.count || 0;
            const invoiceUsage = invoiceUsageByUser.get(user._id.toString());
            return {
                ...user.toObject(),
                businessInfo,
                invoiceCount,
                clientCount,
                invoiceUsage,
            };
        });
        res.json(usersWithDetails);
    } catch (err) {
        return sendServerError(res, err);
    }
});

function sanitizeRegisterBusinessInfo(businessInfo) {
    if (!businessInfo || typeof businessInfo !== 'object') return {};
    return {
        name: sanitizePlainText(businessInfo.name, 200),
        address: sanitizePlainText(businessInfo.address, 500),
        email: businessInfo.email ? sanitizeOptionalEmail(businessInfo.email) : '',
        phone: sanitizePlainText(businessInfo.phone, 50),
        website: sanitizePlainText(businessInfo.website, 200),
        brandColor: sanitizeHexColor(
            businessInfo.brandColor,
            defaultBusinessInfoFields.brandColor
        ),
        taxRate: sanitizeNumber(businessInfo.taxRate, {
            min: 0,
            max: 100,
            fallback: defaultBusinessInfoFields.taxRate,
        }),
        paymentAccountName: sanitizePlainText(businessInfo.paymentAccountName, 120),
        paymentBankName: sanitizePlainText(businessInfo.paymentBankName, 120),
        paymentAccountNumber: sanitizePlainText(businessInfo.paymentAccountNumber, 40),
        paymentInstructions: sanitizePlainText(businessInfo.paymentInstructions, 500),
    };
}

// Register
router.post('/register', registerLimiter, async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const password = req.body.password;
        const businessInfo = req.body.businessInfo;
        const sanitizedBusinessInfo = sanitizeRegisterBusinessInfo(businessInfo);
        const name =
            sanitizePlainText(req.body.name, 120) ||
            sanitizedBusinessInfo.name ||
            '';

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password required' });
        }
        if (!isStrongPassword(password)) {
            return res.status(400).json({ message: PASSWORD_REQUIREMENTS_MESSAGE });
        }

        const existing = await User.findOne({ email });
        if (existing) return res.status(409).json({ message: 'Email already registered' });

        const hash = await bcrypt.hash(password, 10);
        const user = await User.create({ email, password: hash, name });
        await BusinessInfo.create({
            userId: user._id,
            ...defaultBusinessInfoFields,
            ...sanitizedBusinessInfo,
        });

        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRY });
        setAuthCookies(res, token);
        res.status(201).json({
            message: 'User registered',
            user: toPublicUser(user),
            token,
        });
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        return sendServerError(res, err);
    }
});

// Login

// Rate limiting and lockout config
const MAX_ATTEMPTS = 5;
const LOCK_TIME = 15 * 60 * 1000; // 15 minutes

router.post('/login', loginLimiter, async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const { password } = req.body;
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
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRY });
        setAuthCookies(res, token);
        res.json({
            user: toPublicUser(user, { lastLogin: user.lastLogin }),
            token,
        });
    } catch (err) {
        return sendServerError(res, err);
    }
});

router.get('/me', async (req, res) => {
    try {
        const token = getTokenFromRequest(req);
        if (!token) {
            return res.json({ user: null });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user || user.status === 'suspended') {
            clearAuthCookies(res);
            return res.json({ user: null });
        }

        return res.json({ user: toPublicUser(user, { lastLogin: user.lastLogin }) });
    } catch {
        clearAuthCookies(res);
        return res.json({ user: null });
    }
});

router.post('/logout', (req, res) => {
    clearAuthCookies(res);
    res.json({ message: 'Logged out' });
});

// Password reset request (send token)
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        if (!email) {
            return res.status(400).json({ message: 'Email is required.' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(200).json(FORGOT_PASSWORD_RESPONSE);
        }

        const lastSent = user.passwordResetRequestedAt?.getTime() || 0;
        const cooldownLeft = RESET_EMAIL_COOLDOWN_MS - (Date.now() - lastSent);
        if (cooldownLeft > 0 && user.passwordResetExpires?.getTime() > Date.now()) {
            return res.status(429).json({
                message: 'Please wait a few minutes before requesting another reset email. Check your inbox for the link we already sent.',
            });
        }

        const token = createPasswordResetToken();
        const resetUrl = `${getFrontendBaseUrl()}/reset-password/${token}`;

        try {
            await sendPasswordResetEmail({ to: user.email, resetUrl });
        } catch (mailErr) {
            console.error('Forgot-password email error:', mailErr);
            return res.status(503).json({
                message: getEmailErrorMessage(mailErr),
            });
        }

        user.passwordResetToken = hashPasswordResetToken(token);
        user.passwordResetExpires = Date.now() + 60 * 60 * 1000;
        user.passwordResetRequestedAt = new Date();
        await user.save();

        res.status(200).json(FORGOT_PASSWORD_RESPONSE);
    } catch (err) {
        console.error('Forgot-password error:', err);
        res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }
});

// Password reset (set new password)
router.post('/reset-password/:token', resetPasswordLimiter, async (req, res) => {
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
router.patch('/admin/users/:id/plan', auth, validateObjectId(), async (req, res) => {
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
        return sendServerError(res, err);
    }
});

// Admin unlock user
router.patch('/admin/users/:id/unlock', auth, validateObjectId(), async (req, res) => {
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
        return sendServerError(res, err);
    }
});

// Admin: reset free-plan monthly invoice quota (5 invoices)
router.patch('/admin/users/:id/invoice-usage/reset', auth, validateObjectId(), async (req, res) => {
    try {
        const adminUser = await User.findById(req.user.userId);
        if (!adminUser || !adminUser.isAdmin) {
            return res.status(403).json({ message: 'Forbidden: Admins only' });
        }
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const usage = await resetFreeInvoiceUsageForUser(req.params.id);
        res.json({
            message: 'Free invoice quota reset for this month.',
            invoiceUsage: usage,
        });
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        return sendServerError(res, err);
    }
});

export default router;
