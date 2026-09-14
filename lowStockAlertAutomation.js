import BusinessInfo from './models/CompanyInfo.js';
import User from './models/User.js';
import { sendLowStockAlertEmail } from './src/emails/senders/lowStockAlertEmail.js';
import { getWebsiteUrl } from './src/emails/config.js';
import {
    findLowStockProductsForUser,
    findOutOfStockProductsForUser,
} from './utils/lowStockProducts.js';

const DIGEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 50;

function canSendDigest(lastSentAt) {
    if (!lastSentAt) return true;
    return Date.now() - new Date(lastSentAt).getTime() >= DIGEST_COOLDOWN_MS;
}

function mapProductsForEmail(products) {
    return products.map((product) => ({
        name: product.name,
        quantityOnHand: Number(product.quantityOnHand ?? 0),
        lowStockThreshold: product.lowStockThreshold == null
            ? null
            : Number(product.lowStockThreshold),
    }));
}

async function sendLowStockDigests() {
    const baseFilter = { lowStockEmailAlerts: true };
    let lastId = null;
    let processed = 0;
    let skipped = 0;
    const productsUrl = `${getWebsiteUrl()}/products`;

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
            if (!canSendDigest(info.lowStockEmailLastSentAt)) {
                skipped += 1;
                continue;
            }

            const user = userById.get(String(info.userId));
            if (!user?.email?.trim() || user.status === 'suspended') {
                skipped += 1;
                continue;
            }

            const [lowStockProducts, outOfStockProducts] = await Promise.all([
                findLowStockProductsForUser(info.userId),
                findOutOfStockProductsForUser(info.userId),
            ]);
            if (lowStockProducts.length === 0 && outOfStockProducts.length === 0) {
                skipped += 1;
                continue;
            }

            try {
                await sendLowStockAlertEmail({
                    to: user.email.trim().toLowerCase(),
                    ownerName: user.name?.trim() || info.name?.trim() || 'there',
                    products: mapProductsForEmail(lowStockProducts),
                    outOfStockProducts: mapProductsForEmail(outOfStockProducts),
                    productsUrl,
                });

                info.lowStockEmailLastSentAt = new Date();
                await info.save();
                processed += 1;
            } catch (err) {
                console.error('[Waraqah Email] Low stock digest failed:', {
                    userId: info.userId,
                    message: err.message,
                });
            }
        }

        if (candidates.length < BATCH_SIZE) break;
    }

    return { processed, skipped };
}

export { sendLowStockDigests, DIGEST_COOLDOWN_MS };
