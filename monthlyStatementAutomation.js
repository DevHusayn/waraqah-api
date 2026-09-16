import BusinessInfo from './models/CompanyInfo.js';
import User from './models/User.js';
import { sendMonthlyStatementEmail } from './src/emails/senders/monthlyStatementEmail.js';
import { getWebsiteUrl } from './src/emails/config.js';
import { isPremiumActive } from './utils/businessInfoHelpers.js';
import { getYearMonthInTimezone } from './utils/timezone.js';
import { loadMonthlyStatementForUser } from './utils/monthlyStatementData.js';
import {
    buildMonthlyStatementFilename,
    generateMonthlyStatementPdfBuffer,
} from './utils/monthlyStatementPdf.js';
import { formatStatementPeriodKey } from './utils/monthlyStatementBuild.js';

const BATCH_SIZE = 50;

function getPreviousStatementMonth(timezone) {
    const { year, month } = getYearMonthInTimezone(timezone);
    if (month === 1) {
        return { year: year - 1, month: 12 };
    }
    return { year, month: month - 1 };
}

async function sendMonthlyStatements({ forcePeriodKey = null } = {}) {
    const baseFilter = {
        autoEmailMonthlyStatements: { $ne: false },
    };

    let lastId = null;
    let processed = 0;
    let skipped = 0;
    const statementsUrl = `${getWebsiteUrl()}/statements`;

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
            if (!isPremiumActive(info)) {
                skipped += 1;
                continue;
            }

            const { year, month } = getPreviousStatementMonth(info.timezone);
            const periodKey = forcePeriodKey || formatStatementPeriodKey(year, month);

            if (!forcePeriodKey && info.monthlyStatementLastSentFor === periodKey) {
                skipped += 1;
                continue;
            }

            const user = userById.get(String(info.userId));
            if (!user?.email?.trim() || user.status === 'suspended') {
                skipped += 1;
                continue;
            }

            try {
                const [targetYear, targetMonth] = forcePeriodKey
                    ? forcePeriodKey.split('-').map(Number)
                    : [year, month];

                const statement = await loadMonthlyStatementForUser(
                    info.userId,
                    targetYear,
                    targetMonth,
                );

                if (!statement.hasData) {
                    skipped += 1;
                    continue;
                }

                const businessInfo = {
                    name: info.name,
                    email: info.email,
                    brandColor: info.brandColor,
                    defaultCurrency: info.defaultCurrency || 'NGN',
                };
                const pdfBuffer = generateMonthlyStatementPdfBuffer(statement, businessInfo);
                const pdfFilename = buildMonthlyStatementFilename(statement.periodLabel);

                await sendMonthlyStatementEmail({
                    to: user.email.trim().toLowerCase(),
                    ownerName: user.name?.trim() || info.name?.trim() || 'there',
                    periodLabel: statement.periodLabel,
                    totals: statement.totals,
                    statementsUrl,
                    pdfBuffer,
                    pdfFilename,
                    currency: businessInfo.defaultCurrency,
                });

                info.monthlyStatementLastSentFor = periodKey;
                await info.save();
                processed += 1;
            } catch (err) {
                console.error('[Waraqah Email] Monthly statement failed:', {
                    userId: info.userId,
                    message: err.message,
                });
            }
        }

        if (candidates.length < BATCH_SIZE) break;
    }

    return { processed, skipped };
}

export { sendMonthlyStatements };
