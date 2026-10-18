import cron from 'node-cron';
import { sendInsightPushes } from './pushInsightAutomation.js';

cron.schedule('0 * * * *', async () => {
    try {
        const { processed, skipped } = await sendInsightPushes();
        console.log(`[Waraqah Push] Insight check done. Sent ${processed}, skipped ${skipped}.`);
    } catch (err) {
        console.error('[Waraqah Push] Insight check failed:', err);
    }
});
