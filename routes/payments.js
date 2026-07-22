import express from 'express';
import crypto from 'crypto';
import auth from '../middleware/auth.js';
import requireEmailVerified from '../middleware/requireEmailVerified.js';
import User from '../models/User.js';
import Payment from '../models/Payment.js';
import BusinessInfo from '../models/CompanyInfo.js';
import {
    initializeTransaction,
    verifyTransaction,
    generateReference,
    fetchSubscription,
    disableSubscription,
    PREMIUM_AMOUNT_KOBO,
    PREMIUM_AMOUNT_NGN,
} from '../services/paystack.js';
import { getOrCreatePremiumPlanCode } from '../services/paystackPlan.js';
import { activatePremiumForUser, deactivatePremiumSubscription } from '../services/premiumActivation.js';
import { toBusinessInfoResponse } from '../utils/businessInfoHelpers.js';
import { isOriginAllowed } from '../utils/corsConfig.js';
import {
    notifyPremiumUpgradeSuccess,
    notifyPremiumPaymentFailed,
    notifyPremiumSubscriptionCancelled,
} from '../src/emails/helpers/premiumNotifications.js';
import {
    parsePagination,
    paginateFind,
    buildPaginationMeta,
} from '../utils/pagination.js';

const router = express.Router();

function getCallbackUrl(req) {
    const fromClient = req.body?.callbackOrigin;
    if (fromClient) {
        const normalized = String(fromClient).replace(/\/$/, '');
        if (isOriginAllowed(normalized)) {
            return `${normalized}/upgrade/callback`;
        }
    }
    const base = (process.env.FRONTEND_URL || 'http://localhost:5173')
        .toString()
        .replace(/\/$/, '');
    return `${base}/upgrade/callback`;
}

function subscriptionMetaFromCharge(data) {
    const sub = data.subscription || data.authorization?.subscription_code;
    const subscriptionCode = typeof sub === 'string' ? sub : sub?.subscription_code;
    return {
        subscriptionCode: subscriptionCode || '',
        customerCode: data.customer?.customer_code || data.customer?.id || '',
        emailToken: data.subscription?.email_token || '',
    };
}

async function fulfillPremiumPayment(payment, paystackData) {
    if (payment.status === 'success') {
        return payment;
    }
    payment.status = 'success';
    payment.paidAt = paystackData.paid_at ? new Date(paystackData.paid_at) : new Date();
    payment.channel = paystackData.channel || '';
    const subMeta = subscriptionMetaFromCharge(paystackData);
    if (subMeta.subscriptionCode) {
        payment.paystackSubscriptionCode = subMeta.subscriptionCode;
        payment.type = 'subscription';
    }
    await payment.save();

    await activatePremiumForUser(payment.userId, {
        months: 1,
        subscription: subMeta.subscriptionCode ? subMeta : null,
    });
    await notifyPremiumUpgradeSuccess(payment.userId);
    return payment;
}

function formatPaymentForClient(payment) {
    return {
        id: String(payment._id),
        reference: payment.reference,
        amount: payment.amount / 100,
        currency: payment.currency || 'NGN',
        status: payment.status,
        type: payment.type,
        channel: payment.channel || '',
        paidAt: payment.paidAt,
        createdAt: payment.createdAt,
    };
}

async function recordSubscriptionCharge(userId, paystackData) {
    const reference = paystackData.reference;
    if (!reference) return;

    const existing = await Payment.findOne({ reference });
    if (existing) return;

    await Payment.create({
        userId,
        reference,
        amount: paystackData.amount || PREMIUM_AMOUNT_KOBO,
        currency: (paystackData.currency || 'NGN').toUpperCase(),
        status: 'success',
        type: 'subscription',
        channel: paystackData.channel || '',
        paidAt: paystackData.paid_at ? new Date(paystackData.paid_at) : new Date(),
        paystackSubscriptionCode: paystackData.subscription?.subscription_code || '',
    });
}

async function renewBySubscriptionCode(subscriptionCode, paystackData) {
    const info = await BusinessInfo.findOne({ paystackSubscriptionCode: subscriptionCode });
    if (!info) return;
    const subMeta = subscriptionMetaFromCharge(paystackData);
    await activatePremiumForUser(info.userId, {
        months: 1,
        subscription: { ...subMeta, subscriptionCode },
    });
    await recordSubscriptionCharge(info.userId, paystackData);
}

/** Public pricing info */
router.get('/plan', auth, async (req, res) => {
    try {
        const info = await BusinessInfo.findOne({ userId: req.user.userId });
        let paystackPlanCode = process.env.PAYSTACK_PLAN_CODE || '';
        if (process.env.PAYSTACK_SECRET_KEY && !paystackPlanCode) {
            try {
                paystackPlanCode = await getOrCreatePremiumPlanCode();
            } catch {
                /* plan creation optional for display */
            }
        }
        const secretKey = process.env.PAYSTACK_SECRET_KEY || '';
        res.json({
            name: 'Waraqah Premium',
            amount: PREMIUM_AMOUNT_NGN,
            currency: 'NGN',
            interval: 'monthly',
            billing: 'Auto-renews every month via Paystack',
            paystackConfigured: Boolean(secretKey),
            publicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
            isPaystackTestMode: secretKey.startsWith('sk_test_'),
            devPlanToggleEnabled: process.env.ALLOW_DEV_PLAN === 'true',
            subscription: info?.subscriptionStatus === 'active'
                ? {
                    status: info.subscriptionStatus,
                    renewsAt: info.premiumUntil,
                    code: info.paystackSubscriptionCode,
                }
                : null,
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/** Billing history for the authenticated user */
router.get('/history', auth, async (req, res) => {
    try {
        const { page, limit, skip } = parsePagination(req);
        const { data, total } = await paginateFind(
            Payment,
            { userId: req.user.userId },
            {
                skip,
                limit,
                sort: { paidAt: -1, createdAt: -1 },
                lean: true,
            }
        );
        res.json({
            data: data.map(formatPaymentForClient),
            pagination: buildPaginationMeta(page, limit, total),
        });
    } catch (err) {
        res.status(500).json({ message: err.message || 'Could not load billing history' });
    }
});

/** Start Paystack subscription checkout (first payment + recurring plan) */
router.post('/initialize', auth, requireEmailVerified, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const planCode = await getOrCreatePremiumPlanCode();
        const reference = generateReference(user._id);

        const payment = await Payment.create({
            userId: user._id,
            reference,
            amount: PREMIUM_AMOUNT_KOBO,
            currency: 'NGN',
            status: 'pending',
            type: 'subscription',
        });

        const callbackUrl = getCallbackUrl(req);

        const data = await initializeTransaction({
            email: user.email,
            amountKobo: PREMIUM_AMOUNT_KOBO,
            reference,
            callbackUrl,
            planCode,
            metadata: {
                userId: String(user._id),
                paymentId: String(payment._id),
                plan: 'premium',
                billing: 'subscription',
            },
        });

        res.json({
            authorization_url: data.authorization_url,
            access_code: data.access_code,
            reference,
            callback_url: callbackUrl,
        });
    } catch (err) {
        res.status(err.message.includes('not configured') ? 503 : 500).json({
            message: err.message || 'Could not start payment',
        });
    }
});

/** Verify after Paystack redirect */
router.get('/verify/:reference', auth, async (req, res) => {
    try {
        const payment = await Payment.findOne({
            reference: req.params.reference,
            userId: req.user.userId,
        });
        if (!payment) {
            return res.status(404).json({ message: 'Payment not found' });
        }

        const data = await verifyTransaction(req.params.reference);
        if (data.status !== 'success') {
            payment.status = 'failed';
            await payment.save();
            return res.status(400).json({
                message: 'Payment was not completed',
                status: data.status,
            });
        }

        await fulfillPremiumPayment(payment, data);

        if (data.subscription?.subscription_code) {
            const sub = await fetchSubscription(data.subscription.subscription_code);
            await activatePremiumForUser(req.user.userId, {
                months: 1,
                subscription: {
                    subscriptionCode: sub.subscription_code,
                    customerCode: sub.customer?.customer_code || '',
                    emailToken: sub.email_token || '',
                },
            });
        }

        const businessInfo = await BusinessInfo.findOne({ userId: req.user.userId });

        res.json({
            message: 'Subscription active. Premium renews automatically each month.',
            businessInfo: toBusinessInfoResponse(businessInfo),
        });
    } catch (err) {
        res.status(500).json({ message: err.message || 'Verification failed' });
    }
});

/** Cancel auto-renewal (stays premium until premiumUntil) */
router.post('/subscription/cancel', auth, async (req, res) => {
    try {
        const info = await BusinessInfo.findOne({ userId: req.user.userId });
        if (!info?.paystackSubscriptionCode) {
            return res.status(400).json({ message: 'No active subscription found' });
        }

        let emailToken = info.paystackEmailToken;
        if (!emailToken) {
            const sub = await fetchSubscription(info.paystackSubscriptionCode);
            emailToken = sub.email_token;
            info.paystackEmailToken = emailToken;
        }

        await disableSubscription(info.paystackSubscriptionCode, emailToken);
        await deactivatePremiumSubscription(req.user.userId);
        await notifyPremiumSubscriptionCancelled(req.user.userId);

        res.json({
            message: 'Auto-renewal cancelled. Premium remains until the end of your billing period.',
            businessInfo: toBusinessInfoResponse(info),
        });
    } catch (err) {
        res.status(500).json({ message: err.message || 'Could not cancel subscription' });
    }
});

/** Paystack webhook */
export async function paystackWebhookHandler(req, res) {
    try {
        const secret = process.env.PAYSTACK_SECRET_KEY;
        if (!secret) return res.status(503).send('Paystack not configured');

        const signature = req.headers['x-paystack-signature'];
        const hash = crypto.createHmac('sha512', secret).update(req.body).digest('hex');
        if (hash !== signature) return res.status(401).send('Invalid signature');

        const event = JSON.parse(req.body.toString());
        const { event: eventType, data } = event;

        if (eventType === 'charge.success') {
            const { reference } = data;
            const payment = await Payment.findOne({ reference });
            if (payment) {
                await fulfillPremiumPayment(payment, data);
            } else if (data.subscription?.subscription_code) {
                await renewBySubscriptionCode(data.subscription.subscription_code, data);
            }
        }

        if (eventType === 'subscription.create') {
            const userId = data.metadata?.userId || data.customer?.metadata?.userId;
            const subCode = data.subscription_code;
            if (userId && subCode) {
                await activatePremiumForUser(userId, {
                    months: 1,
                    subscription: {
                        subscriptionCode: subCode,
                        customerCode: data.customer?.customer_code || '',
                        emailToken: data.email_token || '',
                    },
                });
            } else if (subCode) {
                const info = await BusinessInfo.findOne({ paystackSubscriptionCode: subCode });
                if (!info) {
                    const payment = await Payment.findOne({ paystackSubscriptionCode: subCode });
                    if (payment) {
                        await activatePremiumForUser(payment.userId, {
                            months: 1,
                            subscription: {
                                subscriptionCode: subCode,
                                emailToken: data.email_token || '',
                            },
                        });
                    }
                }
            }
        }

        if (eventType === 'subscription.disable' || eventType === 'subscription.not_renew') {
            const subCode = data.subscription_code;
            const info = await BusinessInfo.findOne({ paystackSubscriptionCode: subCode });
            if (info) {
                info.subscriptionStatus = 'cancelled';
                await info.save();
                await notifyPremiumSubscriptionCancelled(info.userId);
            }
        }

        if (eventType === 'invoice.payment_failed') {
            const subCode = data.subscription?.subscription_code;
            if (subCode) {
                const info = await BusinessInfo.findOne({ paystackSubscriptionCode: subCode });
                await BusinessInfo.updateOne(
                    { paystackSubscriptionCode: subCode },
                    { $set: { subscriptionStatus: 'attention' } }
                );
                if (info?.userId) {
                    await notifyPremiumPaymentFailed(info.userId);
                }
            }
        }

        res.sendStatus(200);
    } catch (err) {
        console.error('Paystack webhook error:', err);
        res.sendStatus(500);
    }
}

export default router;
