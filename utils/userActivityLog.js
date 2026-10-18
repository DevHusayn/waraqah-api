import UserActivityLog from '../models/UserActivityLog.js';

export async function logUserActivity(userId, type, { title = '', description = '', meta = null, actorId = null } = {}) {
    try {
        await UserActivityLog.create({
            userId,
            type,
            title,
            description,
            meta,
            actorId,
        });
    } catch (err) {
        console.error('Failed to log user activity:', err.message);
    }
}

export async function logUserLogin(userId) {
    await logUserActivity(userId, 'login', {
        title: 'Signed in',
        description: 'User logged in',
    });
}

export async function logUserSuspended(userId, actorId) {
    await logUserActivity(userId, 'suspended', {
        title: 'Account suspended',
        description: 'Account was suspended by an admin',
        actorId,
    });
}

export async function logUserReactivated(userId, actorId) {
    await logUserActivity(userId, 'reactivated', {
        title: 'Account reactivated',
        description: 'Account was reactivated by an admin',
        actorId,
    });
}

export async function logPlanChange(userId, { fromPlan, toPlan, actorId = null } = {}) {
    const upgraded = toPlan === 'premium' && fromPlan !== 'premium';
    const type = upgraded ? 'plan_upgraded' : 'plan_downgraded';
    const title = upgraded ? 'Upgraded to Premium' : 'Downgraded to Free';
    const description = actorId
        ? `Plan changed from ${fromPlan} to ${toPlan} by an admin`
        : `Plan changed from ${fromPlan} to ${toPlan}`;
    await logUserActivity(userId, type, { title, description, meta: { fromPlan, toPlan }, actorId });
}

export async function logSubscriptionCancelled(userId, { billingInterval = null } = {}) {
    await logUserActivity(userId, 'subscription_cancelled', {
        title: 'Subscription cancelled',
        description: billingInterval
            ? `${billingInterval} subscription cancelled`
            : 'Premium subscription cancelled',
        meta: { billingInterval },
    });
}

export async function logAdminEmailSent(userId, actorId, {
    subject,
    preview,
    body,
    from,
    replyTo,
    fromName,
    fromPreset,
    to,
    actionPreset,
    actionLabel,
    actionUrl,
    templateId = '',
    source = 'manual',
} = {}) {
    const fromQueue = source === 'queue';
    await logUserActivity(userId, 'admin_email_sent', {
        title: fromQueue ? 'Follow-up email sent' : 'Email sent by admin',
        description: subject ? `Subject: ${subject}` : (fromQueue ? 'Queued follow-up sent' : 'Admin sent an email'),
        meta: {
            subject: subject || '',
            preview: preview || '',
            body: body || '',
            from: from || '',
            replyTo: replyTo || null,
            fromName: fromName || '',
            fromPreset: fromPreset || '',
            to: to || '',
            actionPreset: actionPreset || 'none',
            actionLabel: actionLabel || '',
            actionUrl: actionUrl || '',
            templateId: templateId || '',
            source: fromQueue ? 'queue' : 'manual',
        },
        actorId,
    });
}

export async function logSubscriptionPaymentFailed(userId) {
    await logUserActivity(userId, 'subscription_payment_failed', {
        title: 'Subscription payment failed',
        description: 'Paystack could not charge the subscription renewal',
    });
}
