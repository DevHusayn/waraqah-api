import BusinessInfo from '../models/CompanyInfo.js';
import PushSubscription from '../models/PushSubscription.js';
import { buildPaymentPush } from './pushInsight.js';
import { getLocalClockInTimezone } from './timezone.js';
import { isPushConfigured, sendPushToSubscriptions } from './webPush.js';

/** At most one immediate payment alert per local day. Later payments wait for the morning briefing. */
export async function maybeNotifyPaymentReceived({
    userId,
    invoiceId,
    invoiceNumber,
    amount,
    currency,
}) {
    if (!isPushConfigured()) return;
    const subscriptions = await PushSubscription.find({ userId }).limit(20).lean();
    if (subscriptions.length === 0) return;

    const info = await BusinessInfo.findOne({ userId }).select('timezone defaultCurrency').lean();
    const { localDate } = getLocalClockInTimezone(info?.timezone);
    const claimed = await BusinessInfo.findOneAndUpdate(
        { userId, paymentPushLastLocalDate: { $ne: localDate } },
        { $set: { paymentPushLastLocalDate: localDate } }
    );
    if (!claimed) return;

    const payload = buildPaymentPush({
        amount,
        currency: currency || info?.defaultCurrency,
        invoiceNumber,
        invoiceId,
    });

    try {
        await sendPushToSubscriptions(subscriptions, payload);
    } catch (err) {
        console.error('[Waraqah Push] Payment alert failed:', {
            userId,
            message: err?.message,
        });
    }
}
