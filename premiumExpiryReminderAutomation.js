import BusinessInfo from './models/CompanyInfo.js';
import User from './models/User.js';
import { PLANS } from './utils/businessInfoHelpers.js';
import { sendPremiumExpiryReminderEmail } from './src/emails/index.js';
import { buildPremiumExpiryPush } from './utils/pushInsight.js';
import { sendPushToUser } from './utils/webPush.js';

const REMINDER_DAYS_MONTHLY = 3;
const REMINDER_DAYS_YEARLY = 7;
const MAX_REMINDER_DAYS = REMINDER_DAYS_YEARLY;
const BATCH_SIZE = 50;

function reminderDaysForInterval(billingInterval) {
    return billingInterval === 'yearly' ? REMINDER_DAYS_YEARLY : REMINDER_DAYS_MONTHLY;
}

function formatDateLabel(date) {
    return new Date(date).toLocaleDateString('en-NG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

function isSameInstant(a, b) {
    if (!a || !b) return false;
    return new Date(a).getTime() === new Date(b).getTime();
}

function isWithinReminderWindow(premiumUntil, billingInterval) {
    const now = Date.now();
    const untilMs = new Date(premiumUntil).getTime();
    if (untilMs <= now) return false;

    const windowMs = reminderDaysForInterval(billingInterval) * 24 * 60 * 60 * 1000;
    return untilMs - now <= windowMs;
}

function reminderAlreadySent(info) {
    return isSameInstant(info.premiumExpiryReminderForUntil, info.premiumUntil);
}

async function sendPremiumExpiryReminders() {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + MAX_REMINDER_DAYS * 24 * 60 * 60 * 1000);

    const baseFilter = {
        plan: PLANS.PREMIUM,
        premiumUntil: { $gt: now, $lte: windowEnd },
        subscriptionStatus: { $ne: 'active' },
    };

    let lastId = null;
    let processed = 0;

    while (true) {
        const batchFilter = { ...baseFilter };
        if (lastId) {
            batchFilter._id = { $gt: lastId };
        }

        const candidates = await BusinessInfo.find(batchFilter)
            .sort({ _id: 1 })
            .limit(BATCH_SIZE);

        if (candidates.length === 0) break;
        lastId = candidates[candidates.length - 1]._id;

        const userIds = candidates.map((info) => info.userId);
        const users = await User.find({ _id: { $in: userIds } })
            .select('_id email name status')
            .lean();
        const userById = new Map(users.map((user) => [String(user._id), user]));

        for (const info of candidates) {
            if (reminderAlreadySent(info)) continue;
            if (!isWithinReminderWindow(info.premiumUntil, info.billingInterval)) continue;

            const user = userById.get(String(info.userId));
            if (!user?.email?.trim() || user.status === 'suspended') continue;

            const premiumUntilLabel = formatDateLabel(info.premiumUntil);

            try {
                await sendPremiumExpiryReminderEmail({
                    to: user.email.trim().toLowerCase(),
                    userName: user.name?.trim() || info.name?.trim() || 'there',
                    premiumUntil: premiumUntilLabel,
                });

                info.premiumExpiryReminderForUntil = info.premiumUntil;
                await info.save();
                processed += 1;
                try {
                    await sendPushToUser(info.userId, buildPremiumExpiryPush(premiumUntilLabel));
                } catch (pushErr) {
                    console.error('[Waraqah Push] Premium expiry alert failed:', {
                        userId: info.userId,
                        message: pushErr?.message,
                    });
                }
            } catch (err) {
                console.error('[Waraqah Email] Premium expiry reminder failed:', {
                    userId: info.userId,
                    message: err.message,
                });
            }
        }

        if (candidates.length < BATCH_SIZE) break;
    }

    return { processed };
}

export { sendPremiumExpiryReminders };
