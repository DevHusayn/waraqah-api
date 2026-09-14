const PAYSTACK_BASE = 'https://api.paystack.co';

export const PREMIUM_AMOUNT_NGN = 5000;
export const PREMIUM_AMOUNT_KOBO = PREMIUM_AMOUNT_NGN * 100;
export const PREMIUM_YEARLY_AMOUNT_NGN = 50000;
export const PREMIUM_YEARLY_AMOUNT_KOBO = PREMIUM_YEARLY_AMOUNT_NGN * 100;
export const PREMIUM_YEARLY_SAVINGS_NGN = PREMIUM_AMOUNT_NGN * 12 - PREMIUM_YEARLY_AMOUNT_NGN;

export const BILLING_INTERVALS = {
    monthly: { amountNgn: PREMIUM_AMOUNT_NGN, amountKobo: PREMIUM_AMOUNT_KOBO, months: 1 },
    yearly: { amountNgn: PREMIUM_YEARLY_AMOUNT_NGN, amountKobo: PREMIUM_YEARLY_AMOUNT_KOBO, months: 12 },
};

export function normalizeBillingInterval(interval) {
    return interval === 'yearly' ? 'yearly' : 'monthly';
}

export function getBillingConfig(interval) {
    return BILLING_INTERVALS[normalizeBillingInterval(interval)];
}

function getSecretKey() {
    const key = process.env.PAYSTACK_SECRET_KEY;
    if (!key) {
        throw new Error('Paystack is not configured. Add PAYSTACK_SECRET_KEY to the server .env file.');
    }
    return key;
}

export async function paystackRequest(path, options = {}) {
    const res = await fetch(`${PAYSTACK_BASE}${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${getSecretKey()}`,
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });
    const body = await res.json();
    if (!body.status) {
        throw new Error(body.message || 'Paystack request failed');
    }
    return body.data;
}

export function generateReference(userId) {
    const slug = String(userId).slice(-6);
    return `wrq_${slug}_${Date.now()}`;
}

export async function initializeTransaction({ email, amountKobo, reference, callbackUrl, metadata, planCode }) {
    const body = {
        email,
        amount: amountKobo,
        currency: 'NGN',
        reference,
        callback_url: callbackUrl,
        metadata,
    };
    if (planCode) {
        body.plan = planCode;
    }
    return paystackRequest('/transaction/initialize', {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

export async function fetchSubscription(subscriptionCode) {
    return paystackRequest(`/subscription/${encodeURIComponent(subscriptionCode)}`, {
        method: 'GET',
    });
}

export async function fetchCustomer(emailOrCode) {
    return paystackRequest(`/customer/${encodeURIComponent(emailOrCode)}`, {
        method: 'GET',
    });
}

export async function listSubscriptions({ customer, plan, page = 1, perPage = 50 } = {}) {
    const params = new URLSearchParams();
    if (customer) params.set('customer', customer);
    if (plan) params.set('plan', plan);
    params.set('page', String(page));
    params.set('perPage', String(perPage));
    return paystackRequest(`/subscription?${params.toString()}`, {
        method: 'GET',
    });
}

export async function listTransactions({ customer, status, page = 1, perPage = 20 } = {}) {
    const params = new URLSearchParams();
    if (customer) params.set('customer', customer);
    if (status) params.set('status', status);
    params.set('page', String(page));
    params.set('perPage', String(perPage));
    return paystackRequest(`/transaction?${params.toString()}`, {
        method: 'GET',
    });
}

export async function disableSubscription(subscriptionCode, emailToken) {
    return paystackRequest('/subscription/disable', {
        method: 'POST',
        body: JSON.stringify({
            code: subscriptionCode,
            token: emailToken,
        }),
    });
}

/** List Paystack plans (supports status, interval, amount filters). */
export async function listPlans({ status = 'active', interval, amount, page = 1, perPage = 100 } = {}) {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (interval) params.set('interval', interval);
    if (amount != null) params.set('amount', String(amount));
    params.set('page', String(page));
    params.set('perPage', String(perPage));
    return paystackRequest(`/plan?${params.toString()}`, {
        method: 'GET',
    });
}

export async function verifyTransaction(reference) {
    return paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, {
        method: 'GET',
    });
}
