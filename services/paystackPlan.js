import { paystackRequest, PREMIUM_AMOUNT_KOBO } from './paystack.js';

const PLAN_NAME = 'Waraqah Premium Monthly';

let cachedPlanCode = process.env.PAYSTACK_PLAN_CODE || null;

/** Returns Paystack plan_code (PLN_xxx). Creates plan once if not in env. */
export async function getOrCreatePremiumPlanCode() {
    if (cachedPlanCode) return cachedPlanCode;
    if (process.env.PAYSTACK_PLAN_CODE) {
        cachedPlanCode = process.env.PAYSTACK_PLAN_CODE;
        return cachedPlanCode;
    }

    const plan = await paystackRequest('/plan', {
        method: 'POST',
        body: JSON.stringify({
            name: PLAN_NAME,
            interval: 'monthly',
            amount: PREMIUM_AMOUNT_KOBO,
            currency: 'NGN',
            description: 'Waraqah Premium — logo on PDFs, sidebar branding',
        }),
    });

    cachedPlanCode = plan.plan_code;
    console.log(
        `[Paystack] Created subscription plan. Add to .env:\nPAYSTACK_PLAN_CODE=${cachedPlanCode}`
    );
    return cachedPlanCode;
}
