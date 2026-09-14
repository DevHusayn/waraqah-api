import express from 'express';
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
    PREMIUM_AMOUNT_NGN,
    PREMIUM_AMOUNT_KOBO,
    PREMIUM_YEARLY_AMOUNT_NGN,
    PREMIUM_YEARLY_SAVINGS_NGN,
    getBillingConfig,
    normalizeBillingInterval,
} from '../services/paystack.js';
import { getOrCreatePremiumPlanCode } from '../services/paystackPlan.js';
import {
    activatePremiumForUser,
    deactivatePremiumSubscription,
    linkPaystackSubscription,
    nextPaymentDateFromSubscription,
    reconcilePremiumUntilForUser,
} from '../services/premiumActivation.js';
import {
    ensurePaystackSubscriptionLinked,
    needsSubscriptionLink,
    resolveUserIdForSubscriptionEvent,
    subscriptionMetaFromCharge,
} from '../services/paystackSubscriptionLink.js';
import { billingHistoryQuery, expireAbandonedCheckouts } from '../services/billingHistory.js';
import {
    PaystackChargeMismatchError,
    assertChargeMatchesInterval,
    assertChargeMatchesPayment,
    chargeMatchesExpected,
    isValidPaystackSignature,
} from '../services/paystackVerify.js';
import { toBusinessInfoResponse, isPremiumActive } from '../utils/businessInfoHelpers.js';
import { isOriginAllowed } from '../utils/corsConfig.js';
import {
    notifyPremiumUpgradeSuccess,
    notifyPremiumPaymentFailed,
    notifyPremiumSubscriptionCancelled,
} from '../src/emails/helpers/premiumNotifications.js';
import {
    logSubscriptionCancelled,
    logSubscriptionPaymentFailed,
} from '../utils/userActivityLog.js';
import {
    parsePagination,
    paginateFind,
    buildPaginationMeta,
} from '../utils/pagination.js';
import { paymentVerificationLimiter } from '../middleware/rateLimits.js';

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

function monthsForInterval(interval) {
    return getBillingConfig(interval).months;
}

function renewalMessage(interval) {
    return interval === 'yearly'
        ? 'Subscription active. Premium renews automatically each year.'
        : 'Subscription active. Premium renews automatically each month.';
}

async function disablePreviousMonthlySubscription(userId) {
    const info = await BusinessInfo.findOne({ userId });
    if (!info?.paystackSubscriptionCode) {
        return;
    }
    const isMonthlySub = !info.billingInterval || info.billingInterval === 'monthly';
    if (!isMonthlySub) {
        return;
    }

    let emailToken = info.paystackEmailToken;
    if (!emailToken) {
        const sub = await fetchSubscription(info.paystackSubscriptionCode);
        emailToken = sub.email_token;
    }

    try {
        await disableSubscription(info.paystackSubscriptionCode, emailToken);
    } catch (err) {
        console.error('Could not disable previous monthly subscription:', err.message);
    }
}

async function fulfillPremiumPayment(payment, paystackData, { resolveSubscription = true } = {}) {
    const firstFulfillment = payment.status !== 'success';
    const billingInterval = normalizeBillingInterval(payment.billingInterval || 'monthly');
    const months = monthsForInterval(billingInterval);
    const subMeta = subscriptionMetaFromCharge(paystackData);

    if (firstFulfillment) {
        assertChargeMatchesPayment(paystackData, payment);
        payment.status = 'success';
        payment.paidAt = paystackData.paid_at ? new Date(paystackData.paid_at) : new Date();
        payment.channel = paystackData.channel || '';
        payment.billingInterval = billingInterval;
        if (subMeta.subscriptionCode) {
            payment.paystackSubscriptionCode = subMeta.subscriptionCode;
            payment.type = 'subscription';
        }
        await payment.save();

        if (payment.switchFromMonthly && billingInterval === 'yearly') {
            await disablePreviousMonthlySubscription(payment.userId);
        }
    }

    let info = await BusinessInfo.findOne({ userId: payment.userId });
    if (!isPremiumActive(info)) {
        info = await activatePremiumForUser(payment.userId, {
            months,
            billingInterval,
            subscription: subMeta.subscriptionCode ? subMeta : null,
            fromPayment: true,
            premiumUntil: subMeta.nextPaymentDate || null,
        });
    } else if (subMeta.subscriptionCode && needsSubscriptionLink(info)) {
        info = await linkPaystackSubscription(payment.userId, {
            subscription: subMeta,
            billingInterval,
        });
    }

    if (firstFulfillment) {
        await notifyPremiumUpgradeSuccess(payment.userId, { billingInterval });
    }

    if (resolveSubscription && needsSubscriptionLink(info)) {
        await ensurePaystackSubscriptionLinked({
            userId: payment.userId,
            payment,
            paystackData,
        });
    }

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
        billingInterval: payment.billingInterval || null,
        channel: payment.channel || '',
        paidAt: payment.paidAt,
        createdAt: payment.createdAt,
    };
}

async function recordSubscriptionCharge(userId, paystackData, billingInterval = 'monthly') {
    const reference = paystackData.reference;
    if (!reference) return;

    const existing = await Payment.findOne({ reference });
    if (existing) return;

    const interval = normalizeBillingInterval(billingInterval);
    assertChargeMatchesInterval(paystackData, interval);
    const fallbackAmount = getBillingConfig(interval).amountKobo;

    await Payment.create({
        userId,
        reference,
        amount: paystackData.amount || fallbackAmount,
        currency: (paystackData.currency || 'NGN').toUpperCase(),
        status: 'success',
        type: 'subscription',
        billingInterval: interval,
        channel: paystackData.channel || '',
        paidAt: paystackData.paid_at ? new Date(paystackData.paid_at) : new Date(),
        paystackSubscriptionCode: paystackData.subscription?.subscription_code || '',
    });
}

async function renewBySubscriptionCode(subscriptionCode, paystackData) {
    const info = await BusinessInfo.findOne({ paystackSubscriptionCode: subscriptionCode });
    if (!info) return null;

    const billingInterval = normalizeBillingInterval(info.billingInterval || 'monthly');
    assertChargeMatchesInterval(paystackData, billingInterval);
    const months = monthsForInterval(billingInterval);
    const subMeta = subscriptionMetaFromCharge(paystackData);

    let nextUntil = subMeta.nextPaymentDate;
    if (!nextUntil) {
        try {
            const sub = await fetchSubscription(subscriptionCode);
            nextUntil = nextPaymentDateFromSubscription(sub);
        } catch (err) {
            console.error('[Paystack] fetchSubscription during renewal failed:', err.message);
        }
    }

    await activatePremiumForUser(info.userId, {
        months,
        billingInterval,
        subscription: { ...subMeta, subscriptionCode, nextPaymentDate: nextUntil },
        premiumUntil: nextUntil,
    });
    await recordSubscriptionCharge(info.userId, paystackData, billingInterval);
    return info;
}

function webhookLog(message, details = {}) {
    console.log('[Paystack webhook]', message, JSON.stringify(details));
}

async function resolvePaymentFromCharge(data) {
    const reference = data?.reference;
    if (!reference) {
        return { payment: null, match: 'no_reference' };
    }

    let payment = await Payment.findOne({ reference });
    if (payment) {
        return { payment, match: 'reference', reference };
    }

    const userId = data.metadata?.userId || data.customer?.metadata?.userId;
    if (userId) {
        payment = await Payment.findOne({ reference, userId }).sort({ createdAt: -1 });
        if (payment) {
            return { payment, match: 'reference_and_userId', reference, userId: String(userId) };
        }

        payment = await Payment.findOne({ userId, status: 'pending' }).sort({ createdAt: -1 });
        if (payment && chargeMatchesExpected(data, { amount: payment.amount, currency: payment.currency })) {
            return {
                payment,
                match: 'pending_by_userId',
                reference,
                userId: String(userId),
                paymentReference: payment.reference,
            };
        }
    }

    const customerEmail = data.customer?.email;
    if (customerEmail) {
        const user = await User.findOne({ email: customerEmail.toLowerCase() });
        if (user) {
            payment = await Payment.findOne({ userId: user._id, status: 'pending' }).sort({ createdAt: -1 });
            if (payment && chargeMatchesExpected(data, { amount: payment.amount, currency: payment.currency })) {
                return {
                    payment,
                    match: 'pending_by_customer_email',
                    reference,
                    userId: String(user._id),
                    customerEmail,
                    paymentReference: payment.reference,
                };
            }
        }
    }

    return { payment: null, match: 'unmatched', reference, userId: userId ? String(userId) : null };
}

/** Public pricing info + subscription status (used by upgrade flow) */
router.get('/plan', auth, paymentVerificationLimiter, async (req, res) => {
    try {
        const info = await reconcilePremiumUntilForUser(req.user.userId)
            || await BusinessInfo.findOne({ userId: req.user.userId });
        const secretKey = process.env.PAYSTACK_SECRET_KEY || '';

        res.json({
            name: 'Waraqah Premium',
            amount: PREMIUM_AMOUNT_NGN,
            currency: 'NGN',
            interval: 'monthly',
            billing: 'Auto-renews every month via Paystack',
            plans: {
                monthly: {
                    amount: PREMIUM_AMOUNT_NGN,
                    interval: 'monthly',
                },
                yearly: {
                    amount: PREMIUM_YEARLY_AMOUNT_NGN,
                    interval: 'yearly',
                    savings: PREMIUM_YEARLY_SAVINGS_NGN,
                },
            },
            paystackConfigured: Boolean(secretKey),
            publicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
            isPaystackTestMode: secretKey.startsWith('sk_test_'),
            devPlanToggleEnabled: process.env.ALLOW_DEV_PLAN === 'true',
            isPremium: isPremiumActive(info),
            subscription: info?.subscriptionStatus === 'active'
                ? {
                    status: info.subscriptionStatus,
                    renewsAt: info.premiumUntil,
                    code: info.paystackSubscriptionCode,
                    billingInterval: info.billingInterval || null,
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
        await expireAbandonedCheckouts(req.user.userId);
        const { data, total } = await paginateFind(
            Payment,
            billingHistoryQuery(req.user.userId),
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

        const billingInterval = normalizeBillingInterval(req.body?.interval);
        const switchFromMonthly = Boolean(req.body?.switchFromMonthly);
        const billingConfig = getBillingConfig(billingInterval);

        if (switchFromMonthly) {
            if (billingInterval !== 'yearly') {
                return res.status(400).json({ message: 'Switch is only available for yearly billing' });
            }
            const info = await BusinessInfo.findOne({ userId: user._id });
            if (!info?.paystackSubscriptionCode) {
                return res.status(400).json({ message: 'No active monthly subscription to switch from' });
            }
            const isMonthlySub = !info.billingInterval || info.billingInterval === 'monthly';
            if (!isMonthlySub) {
                return res.status(400).json({ message: 'No active monthly subscription to switch from' });
            }
            if (info.subscriptionStatus !== 'active') {
                return res.status(400).json({ message: 'Your monthly subscription is not active' });
            }
        }

        const planCode = await getOrCreatePremiumPlanCode(billingInterval);
        const reference = generateReference(user._id);
        const callbackUrl = getCallbackUrl(req);

        let payment = null;
        try {
            payment = await Payment.create({
                userId: user._id,
                reference,
                amount: billingConfig.amountKobo,
                currency: 'NGN',
                status: 'pending',
                type: 'subscription',
                billingInterval,
                switchFromMonthly,
            });

            const data = await initializeTransaction({
                email: user.email,
                amountKobo: billingConfig.amountKobo,
                reference,
                callbackUrl,
                planCode,
                metadata: {
                    userId: String(user._id),
                    paymentId: String(payment._id),
                    plan: 'premium',
                    billing: 'subscription',
                    interval: billingInterval,
                    switchFromMonthly,
                },
            });

            return res.json({
                authorization_url: data.authorization_url,
                access_code: data.access_code,
                reference,
                callback_url: callbackUrl,
            });
        } catch (err) {
            if (payment?._id) {
                await Payment.deleteOne({ _id: payment._id }).catch(() => {});
            }
            throw err;
        }
    } catch (err) {
        res.status(err.message.includes('not configured') ? 503 : 500).json({
            message: err.message || 'Could not start payment',
        });
    }
});

/** Verify after Paystack redirect — returns as soon as Premium is active. */
router.get('/verify/:reference', auth, paymentVerificationLimiter, async (req, res) => {
    try {
        const reference = req.params.reference;
        const payment = await Payment.findOne({
            reference,
            userId: req.user.userId,
        });
        if (!payment) {
            return res.status(404).json({ message: 'Payment not found' });
        }

        let businessInfo = await BusinessInfo.findOne({ userId: req.user.userId });
        const billingInterval = normalizeBillingInterval(payment.billingInterval || 'monthly');

        const respondVerified = (info, alreadyVerified) => res.json({
            message: renewalMessage(billingInterval),
            businessInfo: toBusinessInfoResponse(info),
            alreadyVerified,
        });

        if (payment.status === 'success' && isPremiumActive(businessInfo)) {
            return respondVerified(businessInfo, true);
        }

        if (payment.status !== 'success') {
            const paystackData = await verifyTransaction(reference);
            if (paystackData.status !== 'success') {
                payment.status = 'failed';
                await payment.save();
                return res.status(400).json({
                    message: 'Payment was not completed',
                    status: paystackData.status,
                });
            }

            await fulfillPremiumPayment(payment, paystackData, { resolveSubscription: false });
            businessInfo = await BusinessInfo.findOne({ userId: req.user.userId });
            return respondVerified(businessInfo, false);
        }

        if (!isPremiumActive(businessInfo)) {
            businessInfo = await activatePremiumForUser(req.user.userId, {
                months: monthsForInterval(billingInterval),
                billingInterval,
                subscription: null,
                fromPayment: true,
            });
        }

        return respondVerified(businessInfo, true);
    } catch (err) {
        if (err instanceof PaystackChargeMismatchError) {
            return res.status(400).json({ message: err.message });
        }
        res.status(500).json({ message: err.message || 'Verification failed' });
    }
});

/** Repair missing Paystack subscription metadata for an already-paid checkout. */
router.post('/subscription/sync', auth, async (req, res) => {
    try {
        const payment = await Payment.findOne({
            userId: req.user.userId,
            type: 'subscription',
            status: 'success',
        }).sort({ paidAt: -1, createdAt: -1 });

        const info = await ensurePaystackSubscriptionLinked({
            userId: req.user.userId,
            payment,
            paystackData: null,
        });

        if (needsSubscriptionLink(info)) {
            return res.status(404).json({
                message: 'No Paystack subscription was found for this account.',
            });
        }

        res.json({
            message: 'Subscription linked successfully.',
            businessInfo: toBusinessInfoResponse(info),
        });
    } catch (err) {
        res.status(500).json({ message: err.message || 'Could not sync subscription' });
    }
});

/** Cancel auto-renewal (stays premium until premiumUntil) */
router.post('/subscription/cancel', auth, async (req, res) => {
    try {
        let info = await BusinessInfo.findOne({ userId: req.user.userId });

        if (!info?.paystackSubscriptionCode) {
            const payment = await Payment.findOne({
                userId: req.user.userId,
                type: 'subscription',
                status: 'success',
            }).sort({ paidAt: -1, createdAt: -1 });

            info = await ensurePaystackSubscriptionLinked({
                userId: req.user.userId,
                payment,
                paystackData: null,
            }) || info;
        }

        if (!info?.paystackSubscriptionCode) {
            return res.status(400).json({
                message: 'No active Paystack subscription found yet. If you just paid, wait a moment and try again.',
            });
        }

        let emailToken = info.paystackEmailToken;
        if (!emailToken) {
            const sub = await fetchSubscription(info.paystackSubscriptionCode);
            emailToken = sub.email_token;
            info.paystackEmailToken = emailToken;
            await info.save();
        }

        await disableSubscription(info.paystackSubscriptionCode, emailToken);
        const updated = await deactivatePremiumSubscription(req.user.userId);
        await notifyPremiumSubscriptionCancelled(req.user.userId, {
            billingInterval: info.billingInterval,
        });

        res.json({
            message: 'Auto-renewal cancelled. Premium remains until the end of your billing period.',
            businessInfo: toBusinessInfoResponse(updated),
        });
    } catch (err) {
        res.status(500).json({ message: err.message || 'Could not cancel subscription' });
    }
});

/** Paystack webhook — registered in index.js BEFORE auth/CSRF/rate-limit middleware. */
export async function paystackWebhookHandler(req, res) {
    const signature = req.headers['x-paystack-signature'];
    webhookLog('entry', {
        method: req.method,
        path: req.originalUrl || req.url,
        hasBody: Boolean(req.body?.length),
        hasSignature: Boolean(signature),
    });

    try {
        const secret = process.env.PAYSTACK_SECRET_KEY;
        if (!secret) {
            webhookLog('rejected', { reason: 'paystack_not_configured' });
            return res.status(503).send('Paystack not configured');
        }

        const signatureValid = isValidPaystackSignature(req.body, signature, secret);
        webhookLog('signature', { valid: signatureValid });

        if (!signatureValid) return res.status(401).send('Invalid signature');

        const event = JSON.parse(req.body.toString());
        const { event: eventType, data } = event;

        webhookLog('event', {
            eventType,
            reference: data?.reference || null,
            customerEmail: data?.customer?.email || null,
            metadataUserId: data?.metadata?.userId || data?.customer?.metadata?.userId || null,
            subscriptionCode:
                data?.subscription?.subscription_code || data?.subscription_code || null,
        });

        if (eventType === 'charge.success') {
            try {
                const resolved = await resolvePaymentFromCharge(data);
                webhookLog('charge.success.resolve', resolved);

                if (resolved.payment) {
                    await fulfillPremiumPayment(resolved.payment, data);
                    const info = await BusinessInfo.findOne({ userId: resolved.payment.userId });
                    webhookLog('charge.success.updated', {
                        userId: String(resolved.payment.userId),
                        paymentId: String(resolved.payment._id),
                        paymentReference: resolved.payment.reference,
                        plan: info?.plan || null,
                        subscriptionStatus: info?.subscriptionStatus || null,
                        premiumUntil: info?.premiumUntil || null,
                    });
                } else if (data.subscription?.subscription_code) {
                    const info = await renewBySubscriptionCode(data.subscription.subscription_code, data);
                    webhookLog('charge.success.renewBySubscription', {
                        subscriptionCode: data.subscription.subscription_code,
                        userId: info ? String(info.userId) : null,
                        matched: Boolean(info),
                    });
                } else {
                    webhookLog('charge.success.unhandled', {
                        reference: data?.reference || null,
                        reason: 'no_payment_or_subscription_match',
                    });
                }
            } catch (err) {
                if (err instanceof PaystackChargeMismatchError) {
                    webhookLog('charge.success.rejected', { reason: err.message });
                } else {
                    throw err;
                }
            }
        }

        if (eventType === 'subscription.create') {
            const subCode = data.subscription_code;
            const userId = await resolveUserIdForSubscriptionEvent(data, subCode);
            const billingInterval = normalizeBillingInterval(
                data.metadata?.interval || (data.plan?.interval === 'annually' ? 'yearly' : 'monthly')
            );
            const months = monthsForInterval(billingInterval);

            if (userId && subCode) {
                const existing = await BusinessInfo.findOne({ userId });
                const nextPaymentDate = nextPaymentDateFromSubscription(data);
                if (isPremiumActive(existing)) {
                    await linkPaystackSubscription(userId, {
                        subscription: {
                            subscriptionCode: subCode,
                            customerCode: data.customer?.customer_code || '',
                            emailToken: data.email_token || '',
                            nextPaymentDate,
                        },
                        billingInterval,
                    });
                } else {
                    await activatePremiumForUser(userId, {
                        months,
                        billingInterval,
                        subscription: {
                            subscriptionCode: subCode,
                            customerCode: data.customer?.customer_code || '',
                            emailToken: data.email_token || '',
                            nextPaymentDate,
                        },
                        premiumUntil: nextPaymentDate,
                    });
                }
                await Payment.updateMany(
                    { userId, type: 'subscription', paystackSubscriptionCode: { $in: ['', null] } },
                    { $set: { paystackSubscriptionCode: subCode } },
                );
                const info = await BusinessInfo.findOne({ userId });
                webhookLog('subscription.create.updated', {
                    userId: String(userId),
                    subscriptionCode: subCode,
                    plan: info?.plan || null,
                    subscriptionStatus: info?.subscriptionStatus || null,
                });
            } else if (subCode) {
                webhookLog('subscription.create.unhandled', { subscriptionCode: subCode });
            }
        }

        if (eventType === 'subscription.disable' || eventType === 'subscription.not_renew') {
            const subCode = data.subscription_code;
            const info = await BusinessInfo.findOne({ paystackSubscriptionCode: subCode });
            if (info && info.paystackSubscriptionCode === subCode && info.subscriptionStatus !== 'cancelled') {
                info.subscriptionStatus = 'cancelled';
                await info.save();
                await logSubscriptionCancelled(info.userId, {
                    billingInterval: info.billingInterval,
                });
                await notifyPremiumSubscriptionCancelled(info.userId, {
                    billingInterval: info.billingInterval,
                });
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
                    await logSubscriptionPaymentFailed(info.userId);
                    await notifyPremiumPaymentFailed(info.userId);
                }
            }
        }

        res.sendStatus(200);
    } catch (err) {
        webhookLog('error', { message: err.message });
        console.error('Paystack webhook error:', err);
        res.sendStatus(500);
    }
}

export default router;
