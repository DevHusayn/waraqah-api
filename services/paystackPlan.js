import {
    paystackRequest,
    listPlans,
    PREMIUM_AMOUNT_KOBO,
    PREMIUM_YEARLY_AMOUNT_KOBO,
    normalizeBillingInterval,
} from './paystack.js';
import { isProduction } from '../utils/envValidation.js';

const PLAN_CONFIG = {
    monthly: {
        name: 'Waraqah Premium Monthly',
        interval: 'monthly',
        amountKobo: PREMIUM_AMOUNT_KOBO,
        envKey: 'PAYSTACK_PLAN_CODE',
        description: 'Waraqah Premium — logo on PDFs, sidebar branding',
    },
    yearly: {
        name: 'Waraqah Premium Yearly',
        interval: 'annually',
        amountKobo: PREMIUM_YEARLY_AMOUNT_KOBO,
        envKey: 'PAYSTACK_PLAN_CODE_YEARLY',
        description: 'Waraqah Premium — same features, billed once per year',
    },
};

const cachedPlanCodes = {
    monthly: process.env.PAYSTACK_PLAN_CODE || null,
    yearly: process.env.PAYSTACK_PLAN_CODE_YEARLY || null,
};

const inFlightPlanLookups = {};

function normalizePlanList(result) {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.data)) return result.data;
    return [];
}

/** Pick the oldest active plan that matches our billing config. */
export function pickMatchingPlanCode(plans, config) {
    const matches = normalizePlanList(plans).filter((plan) => {
        if (plan?.currency !== 'NGN') return false;
        if (plan?.amount !== config.amountKobo) return false;
        if (plan?.interval !== config.interval) return false;
        if (plan?.name && plan.name !== config.name) return false;
        return Boolean(plan?.plan_code);
    });

    if (matches.length === 0) return null;

    matches.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    return matches[0].plan_code;
}

async function findExistingPlanCode(config) {
    const listed = await listPlans({
        status: 'active',
        interval: config.interval,
        amount: config.amountKobo,
        perPage: 100,
    });
    return pickMatchingPlanCode(listed, config);
}

async function resolvePremiumPlanCode(billingInterval) {
    const config = PLAN_CONFIG[billingInterval];

    const existingCode = await findExistingPlanCode(config);
    if (existingCode) {
        cachedPlanCodes[billingInterval] = existingCode;
        console.log(
            `[Paystack] Reusing existing ${billingInterval} plan ${existingCode}. Set ${config.envKey}=${existingCode} in .env to skip lookup.`
        );
        return existingCode;
    }

    const plan = await paystackRequest('/plan', {
        method: 'POST',
        body: JSON.stringify({
            name: config.name,
            interval: config.interval,
            amount: config.amountKobo,
            currency: 'NGN',
            description: config.description,
        }),
    });

    cachedPlanCodes[billingInterval] = plan.plan_code;
    console.log(
        `[Paystack] Created ${billingInterval} subscription plan. Add to .env:\n${config.envKey}=${plan.plan_code}`
    );
    return plan.plan_code;
}

export function requirePinnedPlanCode(interval = 'monthly') {
    const billingInterval = normalizeBillingInterval(interval);
    const config = PLAN_CONFIG[billingInterval];
    const envCode = process.env[config.envKey]?.trim();
    if (envCode) return envCode;
    if (isProduction()) {
        throw new Error(
            `Set ${config.envKey} to the Paystack plan code. Production will not create plans at checkout.`,
        );
    }
    return null;
}

/** Returns Paystack plan_code (PLN_xxx). Production uses env only; local may look up or create. */
export async function getOrCreatePremiumPlanCode(interval = 'monthly') {
    const billingInterval = normalizeBillingInterval(interval);
    const config = PLAN_CONFIG[billingInterval];

    if (cachedPlanCodes[billingInterval]) {
        return cachedPlanCodes[billingInterval];
    }

    const envCode = requirePinnedPlanCode(billingInterval);
    if (envCode) {
        cachedPlanCodes[billingInterval] = envCode;
        return envCode;
    }

    if (!inFlightPlanLookups[billingInterval]) {
        inFlightPlanLookups[billingInterval] = resolvePremiumPlanCode(billingInterval).finally(() => {
            delete inFlightPlanLookups[billingInterval];
        });
    }

    return inFlightPlanLookups[billingInterval];
}
