const PAYSTACK_BASE = 'https://api.paystack.co';

export const PREMIUM_AMOUNT_NGN = 5000;
export const PREMIUM_AMOUNT_KOBO = PREMIUM_AMOUNT_NGN * 100;

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
        channels: ['card', 'bank', 'ussd', 'bank_transfer'],
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

export async function disableSubscription(subscriptionCode, emailToken) {
    return paystackRequest('/subscription/disable', {
        method: 'POST',
        body: JSON.stringify({
            code: subscriptionCode,
            token: emailToken,
        }),
    });
}

export async function verifyTransaction(reference) {
    return paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, {
        method: 'GET',
    });
}
