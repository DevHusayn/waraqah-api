
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import BusinessInfo from '../models/CompanyInfo.js';
import auth from '../middleware/auth.js';
import requireAdmin from '../middleware/requireAdmin.js';
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
import {
    sendPasswordResetEmail,
    getEmailErrorMessage,
    PASSWORD_RESET_EXPIRY_MINUTES,
    sendEmailVerificationEmail,
    sendAdminMessageEmail,
    renderAdminMessageEmail,
} from '../src/emails/index.js';
import {
    sendOAuthSignupEmails,
    sendRegistrationEmails,
    sendWelcomeAfterVerification,
} from '../src/emails/helpers/accountEmails.js';
import { notifyAccountReactivated, notifyAccountSuspended } from '../src/emails/helpers/premiumNotifications.js';
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
    adminEmailLimiter,
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
    paginateFind,
} from '../utils/pagination.js';
import Quotation from '../models/Quotation.js';
import Product from '../models/Product.js';
import Payment from '../models/Payment.js';
import AdminNote from '../models/AdminNote.js';
import UserActivityLog from '../models/UserActivityLog.js';
import { buildUserTimeline, buildSubscriptionHistory } from '../utils/adminUserTimeline.js';
import {
    parseAdminUserFilters,
    buildAdminUserFilter,
    buildAdminUserFilterSlug,
} from '../utils/adminUserFilters.js';
import {
    enrichAdminUsers,
    adminUsersToCsv,
    ADMIN_USER_EXPORT_MAX,
} from '../utils/adminUserExport.js';
import { adminDisplayName } from '../utils/adminDisplayName.js';
import { isProtectedAdminUser } from '../utils/protectedAdmin.js';
import {
    logUserLogin,
    logUserSuspended,
    logUserReactivated,
    logPlanChange,
    logAdminEmailSent,
} from '../utils/userActivityLog.js';
import {
    listAdminMessageActionOptions,
    listAdminMessageSenderOptions,
    listAdminMessageTemplates,
    parseAdminMessageInput,
    resolveAdminMessageGreeting,
} from '../src/emails/helpers/adminMessage.js';

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
    await logUserLogin(user._id);

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRY });
    const csrfToken = setAuthCookies(res, token);

    return {
        user: toPublicUser(user, { lastLogin: user.lastLogin }),
        token,
        csrfToken,
    };
}

// Admin: Suspend/Activate user
router.patch('/admin/users/:id/status', auth, requireAdmin, validateObjectId(), async (req, res) => {
    try {
        if (req.user.userId === req.params.id) return res.status(400).json({ message: 'You cannot change your own status.' });
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        if (isProtectedAdminUser(user) && user.status === 'active') {
            return res.status(403).json({ message: 'This account is protected and cannot be suspended.' });
        }
        const wasActive = user.status === 'active';
        user.status = wasActive ? 'suspended' : 'active';
        await user.save();
        if (wasActive) {
            await notifyAccountSuspended(user);
            await logUserSuspended(user._id, req.user.userId);
        } else {
            await notifyAccountReactivated(user);
            await logUserReactivated(user._id, req.user.userId);
        }
        res.json({ message: 'User status updated', status: user.status });
    } catch (err) {
        return sendServerError(res, err);
    }
});

// Admin: Promote/Demote user
router.patch('/admin/users/:id/admin', auth, requireAdmin, validateObjectId(), async (req, res) => {
    try {
        if (req.user.userId === req.params.id) return res.status(400).json({ message: 'You cannot change your own admin status.' });
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        if (isProtectedAdminUser(user)) {
            return res.status(403).json({ message: 'This account is protected and cannot have admin access changed.' });
        }
        user.isAdmin = !user.isAdmin;
        await user.save();
        res.json({ message: 'User admin status updated', isAdmin: user.isAdmin });
    } catch (err) {
        return sendServerError(res, err);
    }
});

// Admin: Delete user
router.delete('/admin/users/:id', auth, requireAdmin, validateObjectId(), async (req, res) => {
    try {
        if (req.user.userId === req.params.id) return res.status(400).json({ message: 'You cannot delete yourself.' });
        const existing = await User.findById(req.params.id);
        if (!existing) return res.status(404).json({ message: 'User not found' });
        if (isProtectedAdminUser(existing)) {
            return res.status(403).json({ message: 'This account is protected and cannot be deleted.' });
        }
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

router.get('/admin/users', auth, requireAdmin, async (req, res) => {
    try {
        const { page, limit, skip } = parsePagination(req);
        const filters = parseAdminUserFilters(req.query);
        const filter = await buildAdminUserFilter(filters);

        const [users, total, totalUsers, premiumCount, suspendedCount] = await Promise.all([
            User.find(filter, '-password').sort({ createdAt: -1 }).skip(skip).limit(limit),
            User.countDocuments(filter),
            User.countDocuments({}),
            BusinessInfo.countDocuments({ plan: 'premium' }),
            User.countDocuments({ status: 'suspended' }),
        ]);

        const usersWithDetails = await enrichAdminUsers(users);
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

router.get('/admin/users/export', auth, requireAdmin, async (req, res) => {
    try {
        const filters = parseAdminUserFilters(req.query);
        const filter = await buildAdminUserFilter(filters);
        const total = await User.countDocuments(filter);

        if (total > ADMIN_USER_EXPORT_MAX) {
            return res.status(400).json({
                message: `Export limited to ${ADMIN_USER_EXPORT_MAX} users. Refine your filters and try again.`,
            });
        }

        const users = await User.find(filter, '-password').sort({ createdAt: -1 }).limit(ADMIN_USER_EXPORT_MAX);
        const usersWithDetails = await enrichAdminUsers(users);
        const csv = adminUsersToCsv(usersWithDetails);
        const slug = buildAdminUserFilterSlug(filters);
        const date = new Date().toISOString().slice(0, 10);
        const filename = `waraqah-users-${slug}-${date}.csv`;

        res.set('Cache-Control', 'no-store');
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(`\uFEFF${csv}`);
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

        await sendRegistrationEmails({
            user,
            verificationToken,
            businessName: sanitizedBusinessInfo?.name,
        });

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

        await sendWelcomeAfterVerification({ user });

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
        const { user, isNewUser, justVerifiedEmail } = await findOrCreateOAuthUser(profile);
        if (isNewUser) {
            await sendOAuthSignupEmails({
                user,
                businessName: user.name,
                signupMethod: 'google',
            });
        } else if (justVerifiedEmail) {
            await sendWelcomeAfterVerification({ user });
        }
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
router.patch('/admin/users/:id/plan', auth, requireAdmin, validateObjectId(), async (req, res) => {
    try {
        const { plan } = req.body;
        if (![PLANS.FREE, PLANS.PREMIUM].includes(plan)) {
            return res.status(400).json({ message: 'Plan must be "free" or "premium"' });
        }
        let info = await BusinessInfo.findOne({ userId: req.params.id });
        const previousPlan = info?.plan || PLANS.FREE;
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
        if (previousPlan !== plan) {
            await logPlanChange(req.params.id, {
                fromPlan: previousPlan,
                toPlan: plan,
                actorId: req.user.userId,
            });
        }
        res.json({ message: 'Plan updated', businessInfo: toBusinessInfoResponse(info) });
    } catch (err) {
        return sendServerError(res, err);
    }
});

// Admin unlock user
router.patch('/admin/users/:id/unlock', auth, requireAdmin, validateObjectId(), async (req, res) => {
    try {
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
router.patch('/admin/users/:id/invoice-usage/reset', auth, requireAdmin, validateObjectId(), async (req, res) => {
    try {
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

function formatAdminPayment(payment) {
    return {
        id: String(payment._id),
        reference: payment.reference,
        amount: payment.amount / 100,
        currency: payment.currency || 'NGN',
        status: payment.status,
        type: payment.type,
        billingInterval: payment.billingInterval || null,
        channel: payment.channel || '',
        paidAt: payment.paidAt,
        createdAt: payment.createdAt,
    };
}

// Admin: single user profile (fresh on each load)
router.get('/admin/users/:id', auth, requireAdmin, validateObjectId(), async (req, res) => {
    try {
        const user = await User.findById(req.params.id, '-password').lean();
        if (!user) return res.status(404).json({ message: 'User not found' });

        const userId = user._id;
        const [
            businessInfo,
            invoiceCount,
            quotationCount,
            clientCount,
            productCount,
            invoiceUsage,
        ] = await Promise.all([
            BusinessInfo.findOne({ userId }).lean(),
            Invoice.countDocuments({ userId }),
            Quotation.countDocuments({ userId }),
            Client.countDocuments({ userId }),
            Product.countDocuments({ userId }),
            getInvoiceUsageForUser(userId),
        ]);

        const billing = businessInfo
            ? {
                  plan: businessInfo.plan || 'free',
                  billingInterval: businessInfo.billingInterval || null,
                  subscriptionStatus: businessInfo.subscriptionStatus || null,
                  subscriptionRenews:
                      businessInfo.subscriptionStatus === 'active' && businessInfo.premiumUntil
                          ? businessInfo.premiumUntil
                          : null,
                  premiumUntil: businessInfo.premiumUntil || null,
                  paystackSubscriptionCode: businessInfo.paystackSubscriptionCode || '',
              }
            : {
                  plan: 'free',
                  billingInterval: null,
                  subscriptionStatus: null,
                  subscriptionRenews: null,
                  premiumUntil: null,
                  paystackSubscriptionCode: '',
              };

        res.set('Cache-Control', 'no-store');
        res.json({
            user: {
                id: String(user._id),
                email: user.email,
                name: user.name || '',
                displayName: adminDisplayName(user, businessInfo),
                status: user.status,
                isAdmin: user.isAdmin,
                isProtected: isProtectedAdminUser(user),
                authProvider: user.authProvider || 'local',
                emailVerified: user.emailVerified === undefined ? true : Boolean(user.emailVerified),
                createdAt: user.createdAt,
                lastLogin: user.lastLogin || null,
                lastActiveAt: user.lastActiveAt || null,
                failedLoginAttempts: user.failedLoginAttempts || 0,
                lockUntil: user.lockUntil || null,
            },
            businessInfo: businessInfo ? toBusinessInfoResponse(businessInfo) : null,
            stats: {
                invoiceCount,
                quotationCount,
                clientCount,
                productCount,
            },
            invoiceUsage,
            billing,
        });
    } catch (err) {
        return sendServerError(res, err);
    }
});

// Admin: paginated activity timeline
router.get('/admin/users/:id/activity', auth, requireAdmin, validateObjectId(), async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('_id').lean();
        if (!user) return res.status(404).json({ message: 'User not found' });

        const { page, limit, skip } = parsePagination(req);
        const timeline = await buildUserTimeline(req.params.id, { page, limit, skip });
        if (!timeline) return res.status(404).json({ message: 'User not found' });

        res.set('Cache-Control', 'no-store');
        res.json(timeline);
    } catch (err) {
        return sendServerError(res, err);
    }
});

// Admin: paginated payment history
router.get('/admin/users/:id/payments', auth, requireAdmin, validateObjectId(), async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('_id').lean();
        if (!user) return res.status(404).json({ message: 'User not found' });

        const { page, limit, skip } = parsePagination(req);
        const { data, total } = await paginateFind(
            Payment,
            { userId: req.params.id },
            { skip, limit, sort: { paidAt: -1, createdAt: -1 }, lean: true }
        );

        res.set('Cache-Control', 'no-store');
        res.json({
            data: data.map(formatAdminPayment),
            pagination: buildPaginationMeta(page, limit, total),
        });
    } catch (err) {
        return sendServerError(res, err);
    }
});

// Admin: subscription status history
router.get('/admin/users/:id/subscription-history', auth, requireAdmin, validateObjectId(), async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('_id').lean();
        if (!user) return res.status(404).json({ message: 'User not found' });

        const { page, limit, skip } = parsePagination(req);
        const history = await buildSubscriptionHistory(req.params.id, { page, limit, skip });

        res.set('Cache-Control', 'no-store');
        res.json(history);
    } catch (err) {
        return sendServerError(res, err);
    }
});

// Admin: list notes for a user
router.get('/admin/users/:id/notes', auth, requireAdmin, validateObjectId(), async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('_id').lean();
        if (!user) return res.status(404).json({ message: 'User not found' });

        const notes = await AdminNote.find({ userId: req.params.id })
            .sort({ createdAt: -1 })
            .lean();

        res.set('Cache-Control', 'no-store');
        res.json({
            data: notes.map((note) => ({
                id: String(note._id),
                body: note.body,
                authorId: String(note.authorId),
                authorName: note.authorName || '',
                createdAt: note.createdAt,
                updatedAt: note.updatedAt,
            })),
        });
    } catch (err) {
        return sendServerError(res, err);
    }
});

// Admin: add note
router.post('/admin/users/:id/notes', auth, requireAdmin, validateObjectId(), async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('_id').lean();
        if (!user) return res.status(404).json({ message: 'User not found' });

        const body = sanitizePlainText(req.body?.body, 5000);
        if (!body.trim()) {
            return res.status(400).json({ message: 'Note cannot be empty.' });
        }

        const author = await User.findById(req.user.userId).select('name email').lean();
        const note = await AdminNote.create({
            userId: req.params.id,
            authorId: req.user.userId,
            authorName: author?.name || author?.email || 'Admin',
            body: body.trim(),
        });

        res.status(201).json({
            note: {
                id: String(note._id),
                body: note.body,
                authorId: String(note.authorId),
                authorName: note.authorName,
                createdAt: note.createdAt,
                updatedAt: note.updatedAt,
            },
        });
    } catch (err) {
        return sendServerError(res, err);
    }
});

// Admin: edit note
router.patch('/admin/users/:id/notes/:noteId', auth, requireAdmin, validateObjectId('id'), validateObjectId('noteId'), async (req, res) => {
    try {
        const body = sanitizePlainText(req.body?.body, 5000);
        if (!body.trim()) {
            return res.status(400).json({ message: 'Note cannot be empty.' });
        }

        const note = await AdminNote.findOneAndUpdate(
            { _id: req.params.noteId, userId: req.params.id },
            { $set: { body: body.trim() } },
            { new: true }
        ).lean();

        if (!note) return res.status(404).json({ message: 'Note not found' });

        res.json({
            note: {
                id: String(note._id),
                body: note.body,
                authorId: String(note.authorId),
                authorName: note.authorName || '',
                createdAt: note.createdAt,
                updatedAt: note.updatedAt,
            },
        });
    } catch (err) {
        return sendServerError(res, err);
    }
});

// Admin: sent message history for a user
router.get('/admin/users/:id/emails', auth, requireAdmin, validateObjectId(), async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('_id').lean();
        if (!user) return res.status(404).json({ message: 'User not found' });

        const { page, limit, skip } = parsePagination(req, { defaultLimit: 10 });
        const filter = { userId: req.params.id, type: 'admin_email_sent' };
        const { data, total } = await paginateFind(UserActivityLog, filter, {
            skip,
            limit,
            sort: { createdAt: -1 },
            lean: true,
        });

        const actorIds = [...new Set(data.map((log) => log.actorId).filter(Boolean).map(String))];
        const actors = actorIds.length
            ? await User.find({ _id: { $in: actorIds } }).select('name email').lean()
            : [];
        const nameById = new Map(
            actors.map((actor) => [String(actor._id), actor.name || actor.email || 'Admin'])
        );

        res.set('Cache-Control', 'no-store');
        res.json({
            data: data.map((log) => ({
                id: String(log._id),
                subject: log.meta?.subject || (log.description || '').replace(/^Subject:\s*/, '') || 'Email',
                preview: log.meta?.preview || '',
                body: log.meta?.body || '',
                from: log.meta?.from || '',
                replyTo: log.meta?.replyTo || null,
                fromName: log.meta?.fromName || '',
                fromPreset: log.meta?.fromPreset || '',
                to: log.meta?.to || '',
                actionLabel: log.meta?.actionLabel || '',
                actionUrl: log.meta?.actionUrl || '',
                authorName: log.actorId ? nameById.get(String(log.actorId)) || 'Admin' : 'Admin',
                createdAt: log.createdAt,
            })),
            pagination: buildPaginationMeta(page, limit, total),
        });
    } catch (err) {
        return sendServerError(res, err);
    }
});

// Admin: sender presets for in-app user email
router.get('/admin/email-options', auth, requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
        presets: listAdminMessageSenderOptions(),
        actions: listAdminMessageActionOptions(),
        templates: listAdminMessageTemplates(),
    });
});

async function getAdminEmailRecipient(userId) {
    const [user, business] = await Promise.all([
        User.findById(userId).select('name email').lean(),
        BusinessInfo.findOne({ userId }).select('name').lean(),
    ]);
    if (!user) return null;
    return {
        user,
        greetingName: resolveAdminMessageGreeting({
            userName: user.name,
            businessName: business?.name,
        }),
    };
}

// Admin: preview a message to a user
router.post('/admin/users/:id/email/preview', auth, requireAdmin, validateObjectId(), async (req, res) => {
    try {
        const recipient = await getAdminEmailRecipient(req.params.id);
        if (!recipient) return res.status(404).json({ message: 'User not found' });
        const { user, greetingName } = recipient;
        if (!user.email) {
            return res.status(400).json({ message: 'This user does not have an email address.' });
        }

        const payload = parseAdminMessageInput(req.body);
        const rendered = await renderAdminMessageEmail({
            userName: greetingName,
            preview: payload.preview,
            body: payload.body,
            noReply: payload.fromPreset === 'noreply',
            actionUrl: payload.actionUrl,
            actionLabel: payload.actionLabel,
        });

        res.json({
            html: rendered.html,
            text: rendered.text,
            subject: payload.subject,
            preview: payload.preview,
            from: payload.from,
            replyTo: payload.replyTo || null,
            to: user.email,
            actionUrl: payload.actionUrl || '',
            actionLabel: payload.actionLabel || '',
        });
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        return sendServerError(res, err);
    }
});

// Admin: send a message to a user
router.post('/admin/users/:id/email', auth, requireAdmin, validateObjectId(), adminEmailLimiter, async (req, res) => {
    try {
        const recipient = await getAdminEmailRecipient(req.params.id);
        if (!recipient) return res.status(404).json({ message: 'User not found' });
        const { user, greetingName } = recipient;
        if (!user.email) {
            return res.status(400).json({ message: 'This user does not have an email address.' });
        }

        const payload = parseAdminMessageInput(req.body);

        try {
            await sendAdminMessageEmail({
                to: user.email,
                userName: greetingName,
                subject: payload.subject,
                preview: payload.preview,
                body: payload.body,
                from: payload.from,
                replyTo: payload.replyTo,
                fromPreset: payload.fromPreset,
                actionUrl: payload.actionUrl,
                actionLabel: payload.actionLabel,
            });
        } catch (mailErr) {
            console.error('Admin-user email error:', mailErr);
            return res.status(503).json({ message: getEmailErrorMessage(mailErr) });
        }

        await logAdminEmailSent(user._id, req.user.userId, {
            subject: payload.subject,
            preview: payload.preview,
            body: payload.body,
            from: payload.from,
            replyTo: payload.replyTo,
            fromName: payload.fromName,
            fromPreset: payload.fromPreset,
            to: user.email,
            actionPreset: payload.actionPreset,
            actionLabel: payload.actionLabel,
            actionUrl: payload.actionUrl,
        });

        res.json({
            message: `Email sent to ${user.email}`,
            to: user.email,
            subject: payload.subject,
            from: payload.from,
            replyTo: payload.replyTo || null,
        });
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        return sendServerError(res, err);
    }
});

export default router;
