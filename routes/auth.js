
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import BusinessInfo from '../models/CompanyInfo.js';
import auth from '../middleware/auth.js';
import validateObjectId from '../middleware/validateObjectId.js';
import {
    defaultBusinessInfoFields,
    isBusinessSetupComplete,
    PLANS,
    toBusinessInfoResponse,
} from '../utils/businessInfoHelpers.js';
import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';
import {
    getInvoiceUsageForUser,
    getInvoiceUsageMapForUsers,
    resetFreeInvoiceUsageForUser,
} from '../utils/invoiceLimits.js';
import { sendPasswordResetEmail, getEmailErrorMessage, PASSWORD_RESET_EXPIRY_MINUTES, sendEmailVerificationEmail } from '../src/emails/index.js';
import { sendRegistrationEmails } from '../src/emails/helpers/accountEmails.js';
import { notifyAccountSuspended } from '../src/emails/helpers/premiumNotifications.js';
import { EMAIL_VERIFICATION_EXPIRY_HOURS } from '../src/emails/config.js';
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
import { setAuthCookies, clearAuthCookies, getTokenFromRequest, ensureCsrfCookie } from '../utils/authCookie.js';
import {
    verifyGoogleCredential,
    findOrCreateOAuthUser,
    getOAuthConfig,
} from '../services/oauth.js';
import {
    parsePagination,
    buildPaginationMeta,
    escapeRegex,
} from '../utils/pagination.js';

const router = express.Router();

const FORGOT_PASSWORD_RESPONSE = {
    message: 'If an account exists for that email, we sent a link to reset your password.',
};

/** Minimum time between reset emails to the same account */
const RESET_EMAIL_COOLDOWN_MS = 2 * 60 * 1000;
const VERIFICATION_EMAIL_COOLDOWN_MS = 2 * 60 * 1000;

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function toPublicUser(user, extra = {}) {
    const emailVerified = user.emailVerified === undefined ? true : Boolean(user.emailVerified);
    return {
        id: user._id,
        email: user.email,
        name: user.name,
        authProvider: user.authProvider || 'local',
        isAdmin: user.isAdmin,
        status: user.status,
        emailVerified,
        ...extra,
    };
}

async function buildOAuthLoginResponse(res, user, { isNewUser = false } = {}) {
    const businessInfo = await BusinessInfo.findOne({ userId: user._id }).lean();
    const session = await completeAuthSession(res, user);
    return {
        ...session,
        isNewUser,
        needsBusinessSetup: !isBusinessSetupComplete(businessInfo),
    };
}

function getFrontendBaseUrl() {
    const url = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    return url;
}

async function completeAuthSession(res, user) {
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;
    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRY });
    const csrfToken = setAuthCookies(res, token);

    return {
        user: toPublicUser(user, { lastLogin: user.lastLogin }),
        token,
        csrfToken,
    };
}

// Admin: Suspend/Activate user
router.patch('/admin/users/:id/status', auth, validateObjectId(), async (req, res) => {
    try {
        const adminUser = await User.findById(req.user.userId);
        if (!adminUser || !adminUser.isAdmin) return res.status(403).json({ message: 'Forbidden: Admins only' });
        if (req.user.userId === req.params.id) return res.status(400).json({ message: 'You cannot change your own status.' });
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        const wasActive = user.status === 'active';
        user.status = wasActive ? 'suspended' : 'active';
        await user.save();
        if (wasActive) {
            await notifyAccountSuspended(user);
        }
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

        const { page, limit, skip } = parsePagination(req);
        const search = String(req.query.search || '').trim();
        const filter = {};
        if (search) {
            const regex = new RegExp(escapeRegex(search), 'i');
            filter.$or = [{ email: regex }, { name: regex }];
        }

        const [users, total, totalUsers, premiumCount, suspendedCount] = await Promise.all([
            User.find(filter, '-password').sort({ createdAt: -1 }).skip(skip).limit(limit),
            User.countDocuments(filter),
            User.countDocuments({}),
            BusinessInfo.countDocuments({ plan: 'premium' }),
            User.countDocuments({ status: 'suspended' }),
        ]);

        const userIds = users.map((u) => u._id);
        const [businessInfos, invoiceCounts, clientCounts, invoiceUsageByUser] = await Promise.all([
            BusinessInfo.find({ userId: { $in: userIds } }),
            Invoice.aggregate([
                { $match: { userId: { $in: userIds } } },
                { $group: { _id: '$userId', count: { $sum: 1 } } },
            ]),
            Client.aggregate([
                { $match: { userId: { $in: userIds } } },
                { $group: { _id: '$userId', count: { $sum: 1 } } },
            ]),
            getInvoiceUsageMapForUsers(userIds),
        ]);

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
        res.json({
            data: usersWithDetails,
            pagination: buildPaginationMeta(page, limit, total),
            summary: {
                total: totalUsers,
                premium: premiumCount,
                suspended: suspendedCount,
            },
        });
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
        const verificationToken = createPasswordResetToken();
        const user = await User.create({
            email,
            password: hash,
            name,
            emailVerified: false,
            emailVerificationToken: hashPasswordResetToken(verificationToken),
            emailVerificationExpires: Date.now() + EMAIL_VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000,
            emailVerificationSentAt: new Date(),
        });
        await BusinessInfo.create({
            userId: user._id,
            ...defaultBusinessInfoFields,
            ...sanitizedBusinessInfo,
        });

        await sendRegistrationEmails({ user, verificationToken });

        res.status(201).json({
            message: 'Account created. Check your email to verify your address before signing in.',
            email: user.email,
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
        if (!user.password) {
            return res.status(401).json({
                message: 'This account uses Google sign-in. Continue with Google below.',
            });
        }

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

        if (user.emailVerified === false) {
            return res.status(403).json({
                message: 'Please verify your email before signing in. Check your inbox or request a new verification link.',
                code: 'EMAIL_NOT_VERIFIED',
            });
        }

        const session = await completeAuthSession(res, user);
        res.json(session);
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

        const csrfToken = ensureCsrfCookie(req, res);
        return res.json({
            user: toPublicUser(user, { lastLogin: user.lastLogin }),
            csrfToken,
        });
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
        user.passwordResetExpires = Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000;
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

// Verify email address
router.post('/verify-email/:token', async (req, res) => {
    try {
        const tokenHash = hashPasswordResetToken(req.params.token);
        const user = await User.findOne({
            emailVerificationToken: tokenHash,
            emailVerificationExpires: { $gt: Date.now() },
        });

        if (!user) {
            return res.status(400).json({
                message: 'This verification link is invalid or has expired. Request a new one from your account settings.',
            });
        }

        user.emailVerified = true;
        user.emailVerificationToken = undefined;
        user.emailVerificationExpires = undefined;
        await user.save();

        res.json({ message: 'Your email has been verified.', emailVerified: true });
    } catch (err) {
        console.error('Verify-email error:', err);
        res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }
});

// Resend verification email (authenticated)
router.post('/resend-verification', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (user.emailVerified !== false) {
            return res.status(400).json({ message: 'This email address is already verified.' });
        }

        const lastSent = user.emailVerificationSentAt?.getTime() || 0;
        const cooldownLeft = VERIFICATION_EMAIL_COOLDOWN_MS - (Date.now() - lastSent);
        if (cooldownLeft > 0) {
            return res.status(429).json({
                message: 'Please wait a few minutes before requesting another verification email.',
            });
        }

        const verificationToken = createPasswordResetToken();
        const verificationUrl = `${getFrontendBaseUrl()}/verify-email/${verificationToken}`;

        try {
            await sendEmailVerificationEmail({
                to: user.email,
                userName: user.name,
                verificationUrl,
            });
        } catch (mailErr) {
            console.error('Resend-verification email error:', mailErr);
            return res.status(503).json({ message: getEmailErrorMessage(mailErr) });
        }

        user.emailVerificationToken = hashPasswordResetToken(verificationToken);
        user.emailVerificationExpires = Date.now() + EMAIL_VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000;
        user.emailVerificationSentAt = new Date();
        await user.save();

        res.json({ message: 'Verification email sent. Check your inbox.' });
    } catch (err) {
        console.error('Resend-verification error:', err);
        res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }
});

const RESEND_VERIFICATION_RESPONSE = {
    message: 'If an unverified account exists for that email, we sent a new verification link.',
};

router.post('/resend-verification-email', forgotPasswordLimiter, async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        if (!email) {
            return res.status(400).json({ message: 'Email is required.' });
        }

        const user = await User.findOne({ email });
        if (!user || user.emailVerified !== false) {
            return res.status(200).json(RESEND_VERIFICATION_RESPONSE);
        }

        const lastSent = user.emailVerificationSentAt?.getTime() || 0;
        const cooldownLeft = VERIFICATION_EMAIL_COOLDOWN_MS - (Date.now() - lastSent);
        if (cooldownLeft > 0) {
            return res.status(429).json({
                message: 'Please wait a few minutes before requesting another verification email.',
            });
        }

        const verificationToken = createPasswordResetToken();
        const verificationUrl = `${getFrontendBaseUrl()}/verify-email/${verificationToken}`;

        try {
            await sendEmailVerificationEmail({
                to: user.email,
                userName: user.name,
                verificationUrl,
            });
        } catch (mailErr) {
            console.error('Resend-verification-email error:', mailErr);
            return res.status(503).json({ message: getEmailErrorMessage(mailErr) });
        }

        user.emailVerificationToken = hashPasswordResetToken(verificationToken);
        user.emailVerificationExpires = Date.now() + EMAIL_VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000;
        user.emailVerificationSentAt = new Date();
        await user.save();

        res.status(200).json(RESEND_VERIFICATION_RESPONSE);
    } catch (err) {
        console.error('Resend-verification-email error:', err);
        res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }
});

router.get('/oauth-config', (req, res) => {
    res.json(getOAuthConfig());
});

router.post('/google', loginLimiter, async (req, res) => {
    try {
        const credential = req.body?.credential;
        if (!credential) {
            return res.status(400).json({ message: 'Google credential is required.' });
        }

        const profile = await verifyGoogleCredential(credential);
        const { user, isNewUser } = await findOrCreateOAuthUser(profile);
        const session = await buildOAuthLoginResponse(res, user, { isNewUser });
        res.json(session);
    } catch (err) {
        if (err.status === 503) {
            return res.status(503).json({ message: err.message });
        }
        if (err.status === 403 || err.status === 400) {
            return res.status(err.status).json({ message: err.message });
        }
        console.error('Google sign-in error:', err);
        return res.status(401).json({ message: 'Google sign-in failed. Please try again.' });
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
