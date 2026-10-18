import cron from 'node-cron';
import { enqueueLifecycleFollowUps } from './utils/lifecycleFollowUpService.js';

cron.schedule('0 11 * * *', async () => {
    try {
        const { enqueued, cancelled } = await enqueueLifecycleFollowUps();
        console.log(
            `[Waraqah Email] Lifecycle follow-up queue ran. Enqueued ${enqueued}, cancelled ${cancelled}.`
        );
    } catch (err) {
        console.error('[Waraqah Email] Lifecycle follow-up queue error:', err);
    }
});
